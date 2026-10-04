const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { BCRYPT_ROUNDS } = require('../../config/constants');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');

// Compared against when the user does not exist, so an unknown staff number
// takes as long as a wrong password (doesn't leak which accounts exist).
let dummyHash;

const PROFILE_SELECT = `SELECT u.user_id, u.staff_number, u.full_name, u.email, u.password_hash, u.role,
                               u.department_id, u.is_active, u.google_sub,
                               d.code AS department_code, d.name AS department_name
                          FROM app_user u LEFT JOIN department d USING (department_id)`;

const toProfile = ({
  password_hash: _hash, is_active: _active, google_sub: _sub, ...profile
}) => profile;

// Signs the session JWT (same claims and expiry for every sign-in method) and
// audits the login.
async function issueSession(user, auditValue = null) {
  const token = jwt.sign(
    { user_id: user.user_id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '30m' },
  );
  await withTransaction((client) => writeAudit(client, {
    userId: user.user_id, entityType: 'app_user', entityId: user.user_id, action: 'login', newValue: auditValue,
  }));
  return { token, user: toProfile(user) };
}

async function login(identifier, password) {
  const { rows: [user] } = await pool.query(
    `${PROFILE_SELECT} WHERE u.staff_number = $1 OR lower(u.email) = lower($1)`,
    [identifier],
  );

  dummyHash ??= await bcrypt.hash('dummy-password', BCRYPT_ROUNDS);
  const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
  if (!user || !ok || !user.is_active) {
    throw new AppError(401, 'Invalid credentials');
  }
  return issueSession(user);
}

// ---- Google sign-in --------------------------------------------------------
// Google only proves who someone is. It never creates an account or chooses a
// role: a Google identity can only sign in to an existing, active,
// admin-created account (FR-01).

const googleClientId = () => (process.env.GOOGLE_CLIENT_ID || '').trim() || null;

function requireGoogle() {
  const clientId = googleClientId();
  if (!clientId) throw new AppError(503, 'Google sign-in is not configured');
  return clientId;
}

const clients = new Map();
const clientFor = (clientId) => {
  if (!clients.has(clientId)) clients.set(clientId, new OAuth2Client(clientId));
  return clients.get(clientId);
};

// Verifies a Google ID token (signature, expiry, issuer, audience) and
// requires a verified email. Returns the trusted payload.
async function verifyGoogleCredential(credential) {
  const clientId = requireGoogle();
  let payload;
  try {
    const ticket = await clientFor(clientId).verifyIdToken({ idToken: credential, audience: clientId });
    payload = ticket.getPayload();
  } catch {
    throw new AppError(401, 'Invalid Google credential');
  }
  // verifyIdToken already checks the audience; checked again so a library
  // change can never let a token for another app through.
  const aud = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  if (!payload?.sub || !aud.includes(clientId)) throw new AppError(401, 'Invalid Google credential');
  if (payload.email_verified !== true || !payload.email) {
    throw new AppError(403, 'Your Google account email address is not verified');
  }
  return payload;
}

function googleConfig() {
  return { client_id: requireGoogle() };
}

// Verified name/email only: used to prefill the access-request form. Looks up
// nothing and issues nothing.
async function googleProfile(credential) {
  const p = await verifyGoogleCredential(credential);
  return { name: p.name || '', email: p.email.toLowerCase() };
}

// Returns { token, user } for a matching active account, or
// { no_account: true, name, email } when there is none (no token issued).
async function googleSignIn(credential) {
  const p = await verifyGoogleCredential(credential);
  const email = p.email.toLowerCase();

  let { rows: [user] } = await pool.query(`${PROFILE_SELECT} WHERE u.google_sub = $1`, [p.sub]);

  if (!user) {
    ({ rows: [user] } = await pool.query(`${PROFILE_SELECT} WHERE lower(u.email) = $1`, [email]));
    if (!user) return { no_account: true, name: p.name || '', email };
    if (user.google_sub && user.google_sub !== p.sub) {
      throw new AppError(409, 'This account is already linked to a different Google account');
    }
    if (!user.is_active) throw new AppError(403, 'This account has been deactivated');

    // First Google sign-in for this account: link the Google subject id.
    await withTransaction(async (client) => {
      let linked;
      try {
        ({ rowCount: linked } = await client.query(
          'UPDATE app_user SET google_sub = $2 WHERE user_id = $1 AND google_sub IS NULL',
          [user.user_id, p.sub],
        ));
      } catch (err) {
        if (err.code === '23505') throw new AppError(409, 'This Google account is already linked to another user');
        throw err;
      }
      if (!linked) throw new AppError(409, 'This account is already linked to a different Google account');
      await writeAudit(client, {
        userId: user.user_id, entityType: 'app_user', entityId: user.user_id, action: 'link_google',
        previousValue: { google_sub: null }, newValue: { google_sub: p.sub, email },
      });
    });
    user.google_sub = p.sub;
  }

  if (!user.is_active) throw new AppError(403, 'This account has been deactivated');
  return issueSession(user, { method: 'google' });
}

module.exports = {
  login, googleConfig, googleProfile, googleSignIn,
};

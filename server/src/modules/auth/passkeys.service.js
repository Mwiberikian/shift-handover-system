// Passkeys (WebAuthn): an additional way to sign in to an existing account. A
// successful sign-in goes through issueSession, so the session, its claims and
// the must_change_password rule are the same as for a password login.
//
// Never logged or audited: challenges, public keys, assertions. The library's
// error messages quote the challenge and origin, so they are reduced to a
// reason code and the message itself is dropped.
const { randomUUID } = require('crypto');
const {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} = require('@simplewebauthn/server');
const pool = require('../../config/db');
const { webauthnConfig } = require('../../config/env');
const { withTransaction } = require('../../db/tx');
const AppError = require('../../utils/AppError');
const { writeAudit } = require('../../utils/audit');
const { issueSession, PROFILE_SELECT } = require('./auth.service');

const MAX_PER_USER = 10;
const LOGIN_FAILED = 'Passkey sign-in failed. Use your password or try again.';
const REGISTER_FAILED = 'The passkey could not be added. Please try again.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_COLUMNS = 'id, label, created_at, last_used_at, device_type';

function requireConfig() {
  const config = webauthnConfig();
  if (!config) throw new AppError(404, 'Not found');
  return config;
}

// ---- Challenges -------------------------------------------------------------

async function createChallenge(challenge, purpose, userId = null) {
  await pool.query('DELETE FROM webauthn_challenge WHERE expires_at < now()');
  const { rows: [row] } = await pool.query(
    `INSERT INTO webauthn_challenge (challenge, user_id, purpose, expires_at)
     VALUES ($1, $2, $3, now() + interval '5 minutes') RETURNING id`,
    [challenge, userId, purpose],
  );
  return row.id;
}

// Marks the challenge used and returns it. Atomic, so only one of two
// concurrent attempts gets it. Null if unknown, expired, used or someone else's.
async function consumeChallenge(id, purpose, userId = null) {
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  const { rows: [row] } = await pool.query(
    `UPDATE webauthn_challenge SET used = true
      WHERE id = $1 AND purpose = $2 AND used = false AND expires_at > now()
        AND user_id IS NOT DISTINCT FROM $3
      RETURNING challenge`,
    [id, purpose, userId],
  );
  return row?.challenge ?? null;
}

// A library error as a code that is safe to log.
function reasonFrom(err) {
  const message = String(err?.message);
  if (/challenge/i.test(message)) return 'challenge_mismatch';
  if (/origin/i.test(message)) return 'origin_mismatch';
  if (/RP ID/i.test(message)) return 'rpid_mismatch';
  if (/counter/i.test(message)) return 'counter_replay';
  if (/verification|not present/i.test(message)) return 'user_not_verified';
  return 'verification_error';
}

const logFailure = (event, reason, userId) => {
  console.warn(`${event} reason=${reason} user=${userId ?? 'unknown'}`);
};

// ---- Registration -----------------------------------------------------------

async function registrationOptions(userId) {
  const { rpID, rpName } = requireConfig();
  const { rows: [user] } = await pool.query('SELECT email, full_name FROM app_user WHERE user_id = $1', [userId]);
  const { rows: existing } = await pool.query(
    'SELECT credential_id, transports FROM passkey_credential WHERE user_id = $1',
    [userId],
  );
  if (existing.length >= MAX_PER_USER) throw new AppError(409, `You can have at most ${MAX_PER_USER} passkeys. Remove one first.`);

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.full_name,
    userID: new TextEncoder().encode(userId),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { challenge_id: await createChallenge(options.challenge, 'register', userId), options };
}

async function verifyRegistration(userId, { challenge_id: challengeId, response, label }) {
  const { rpID, origin } = requireConfig();
  const fail = (reason) => {
    logFailure('passkey_register_failed', reason, userId);
    return new AppError(400, REGISTER_FAILED);
  };

  const expectedChallenge = await consumeChallenge(challengeId, 'register', userId);
  if (!expectedChallenge) throw fail('challenge_invalid');

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
    });
  } catch (err) {
    throw fail(reasonFrom(err));
  }
  if (!verification.verified) throw fail('not_verified');

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  try {
    return await withTransaction(async (client) => {
      // Holding the user row keeps two simultaneous registrations under the limit.
      await client.query('SELECT 1 FROM app_user WHERE user_id = $1 FOR UPDATE', [userId]);
      const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM passkey_credential WHERE user_id = $1', [userId]);
      if (n >= MAX_PER_USER) throw new AppError(409, `You can have at most ${MAX_PER_USER} passkeys. Remove one first.`);

      const { rows: [row] } = await client.query(
        `INSERT INTO passkey_credential (credential_id, user_id, public_key, counter, transports, device_type, backed_up, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${LIST_COLUMNS}`,
        [
          credential.id, userId, Buffer.from(credential.publicKey), credential.counter,
          credential.transports ?? [], credentialDeviceType, credentialBackedUp, label || 'Passkey',
        ],
      );
      await writeAudit(client, {
        userId, entityType: 'app_user', entityId: userId, action: 'passkey_added', newValue: { passkey_id: row.id, label: row.label },
      });
      return row;
    });
  } catch (err) {
    if (err.code === '23505') throw new AppError(409, 'This passkey is already registered.');
    throw err;
  }
}

// ---- Sign-in ----------------------------------------------------------------

async function loginOptions() {
  const { rpID } = requireConfig();
  // No allowCredentials: the device offers its discoverable credentials.
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
  return { challenge_id: await createChallenge(options.challenge, 'login'), options };
}

// Every failure answers the same, whatever the reason; the real reason goes to
// the log and to the audit entry as a code.
async function auditLoginFailure(reason, userId) {
  logFailure('passkey_login_failed', reason, userId);
  try {
    await withTransaction((client) => writeAudit(client, {
      userId: userId ?? null,
      entityType: userId ? 'app_user' : 'passkey_login',
      entityId: userId ?? randomUUID(),
      action: 'passkey_login_failed',
      newValue: { reason },
    }));
  } catch (err) {
    logFailure('passkey_audit_failed', err.code ?? 'unknown', userId);
  }
}

class LoginRefused extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

async function verifyLogin({ challenge_id: challengeId, response }) {
  const { rpID, origin } = requireConfig();
  let userId = null;
  try {
    // First, so that any attempt uses up the challenge.
    const expectedChallenge = await consumeChallenge(challengeId, 'login');
    if (!expectedChallenge) throw new LoginRefused('challenge_invalid');
    if (typeof response?.id !== 'string') throw new LoginRefused('malformed');

    const { rows: [passkey] } = await pool.query(
      'SELECT id, credential_id, user_id, public_key, counter, transports FROM passkey_credential WHERE credential_id = $1',
      [response.id],
    );
    if (!passkey) throw new LoginRefused('unknown_credential');
    userId = passkey.user_id;

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: Number(passkey.counter),
          transports: passkey.transports,
        },
      });
    } catch (err) {
      throw new LoginRefused(reasonFrom(err));
    }
    if (!verification.verified) throw new LoginRefused('signature_invalid');

    const { rows: [user] } = await pool.query(`${PROFILE_SELECT} WHERE u.user_id = $1`, [userId]);
    if (!user?.is_active) throw new LoginRefused('user_inactive');

    // The counter must go up. Authenticators that don't use one (synced
    // passkeys) stay at 0. In the WHERE clause so a concurrent replay fails too.
    const { newCounter, credentialBackedUp } = verification.authenticationInfo;
    await withTransaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE passkey_credential SET counter = $2, backed_up = $3, last_used_at = now()
          WHERE id = $1 AND (counter < $2 OR (counter = 0 AND $2 = 0))`,
        [passkey.id, newCounter, credentialBackedUp],
      );
      if (!rowCount) throw new LoginRefused('counter_replay');
      await writeAudit(client, {
        userId, entityType: 'app_user', entityId: userId, action: 'passkey_login_success', newValue: { passkey_id: passkey.id },
      });
    });

    return await issueSession(user, { method: 'passkey' });
  } catch (err) {
    await auditLoginFailure(err instanceof LoginRefused ? err.reason : 'internal_error', userId);
    throw new AppError(400, LOGIN_FAILED);
  }
}

// ---- Managing your own passkeys ----------------------------------------------

async function list(userId) {
  requireConfig();
  const { rows } = await pool.query(
    `SELECT ${LIST_COLUMNS} FROM passkey_credential WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows;
}

async function rename(userId, id, label) {
  requireConfig();
  const { rows: [row] } = await pool.query(
    `UPDATE passkey_credential SET label = $3 WHERE id = $1 AND user_id = $2 RETURNING ${LIST_COLUMNS}`,
    [id, userId, label],
  );
  if (!row) throw new AppError(404, 'Passkey not found');
  return row;
}

async function remove(userId, id) {
  requireConfig();
  await withTransaction(async (client) => {
    const { rows: [row] } = await client.query(
      'DELETE FROM passkey_credential WHERE id = $1 AND user_id = $2 RETURNING id, label',
      [id, userId],
    );
    if (!row) throw new AppError(404, 'Passkey not found');
    await writeAudit(client, {
      userId, entityType: 'app_user', entityId: userId, action: 'passkey_removed', previousValue: { passkey_id: row.id, label: row.label },
    });
  });
}

// Admin: clears a user's passkeys, for example when a device is lost.
async function clearForUser(adminId, targetUserId) {
  requireConfig();
  return withTransaction(async (client) => {
    const { rows: [target] } = await client.query('SELECT user_id FROM app_user WHERE user_id = $1', [targetUserId]);
    if (!target) throw new AppError(404, 'User not found');
    const { rowCount } = await client.query('DELETE FROM passkey_credential WHERE user_id = $1', [targetUserId]);
    if (rowCount) {
      await writeAudit(client, {
        userId: adminId, entityType: 'app_user', entityId: targetUserId, action: 'passkey_removed', newValue: { cleared_by_admin: true, count: rowCount },
      });
    }
    return { removed: rowCount };
  });
}

module.exports = {
  registrationOptions, verifyRegistration, loginOptions, verifyLogin, list, rename, remove, clearForUser, LOGIN_FAILED, MAX_PER_USER,
};

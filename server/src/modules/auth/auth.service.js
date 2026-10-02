const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { BCRYPT_ROUNDS } = require('../../config/constants');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');

// Compared against when the user does not exist, so an unknown staff number
// takes as long as a wrong password (doesn't leak which accounts exist).
let dummyHash;

async function login(identifier, password) {
  const { rows: [user] } = await pool.query(
    `SELECT u.user_id, u.staff_number, u.full_name, u.email, u.password_hash, u.role,
            u.department_id, u.is_active, d.code AS department_code, d.name AS department_name
       FROM app_user u LEFT JOIN department d USING (department_id)
      WHERE u.staff_number = $1 OR lower(u.email) = lower($1)`,
    [identifier],
  );

  dummyHash ??= await bcrypt.hash('dummy-password', BCRYPT_ROUNDS);
  const ok = await bcrypt.compare(password, user ? user.password_hash : dummyHash);
  if (!user || !ok || !user.is_active) {
    throw new AppError(401, 'Invalid credentials');
  }

  const token = jwt.sign(
    { user_id: user.user_id, role: user.role, department_id: user.department_id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRY || '30m' },
  );

  await withTransaction((client) => writeAudit(client, {
    userId: user.user_id, entityType: 'app_user', entityId: user.user_id, action: 'login',
  }));

  const { password_hash: _omit, is_active: _active, ...profile } = user;
  return { token, user: profile };
}

module.exports = { login };

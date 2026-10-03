const bcrypt = require('bcrypt');
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { BCRYPT_ROUNDS } = require('../../config/constants');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { checkFieldDefinition } = require('../handovers/template.validation');

const USER_COLUMNS = `u.user_id, u.staff_number, u.full_name, u.email, u.role, u.department_id, u.is_active,
                      d.code AS department_code, d.name AS department_name`;

// Audit snapshots never include the password hash.
const userAuditView = ({ password_hash: _omit, ...rest }) => rest;

async function departmentExists(db, departmentId) {
  const { rows } = await db.query('SELECT 1 FROM department WHERE department_id = $1', [departmentId]);
  return rows.length > 0;
}

// Every non-admin role works inside exactly one department.
async function assertRoleDepartment(db, role, departmentId) {
  if (role !== 'admin' && !departmentId) {
    throw new AppError(400, `department_id is required for role '${role}'`);
  }
  if (departmentId && !(await departmentExists(db, departmentId))) {
    throw new AppError(400, 'department_id does not exist');
  }
}

function translateUniqueViolation(err) {
  if (err.code === '23505') {
    const field = err.constraint?.includes('email') ? 'email' : 'staff_number';
    throw new AppError(409, `A user with that ${field} already exists`);
  }
  throw err;
}

// ---- Users -----------------------------------------------------------------

async function listUsers({ department_id: departmentId, role, is_active: isActive }) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM app_user u LEFT JOIN department d USING (department_id)
      WHERE ($1::uuid IS NULL OR u.department_id = $1)
        AND ($2::role_enum IS NULL OR u.role = $2)
        AND ($3::boolean IS NULL OR u.is_active = $3)
      ORDER BY d.name NULLS FIRST, u.role, u.full_name`,
    [departmentId || null, role || null, isActive === undefined ? null : isActive === 'true'],
  );
  return rows;
}

async function getUser(userId) {
  const { rows: [user] } = await pool.query(
    `SELECT ${USER_COLUMNS} FROM app_user u LEFT JOIN department d USING (department_id) WHERE u.user_id = $1`,
    [userId],
  );
  if (!user) throw new AppError(404, 'User not found');
  return user;
}

// Inserts and audits a new account inside the caller's transaction. Shared by
// direct creation and by approving an access request (`auditExtra` records
// where the account came from).
async function insertUser(client, admin, body, auditExtra = {}) {
  await assertRoleDepartment(client, body.role, body.department_id);
  const passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
  let user;
  try {
    ({ rows: [user] } = await client.query(
      `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true)) RETURNING *`,
      [body.staff_number, body.full_name, body.email.toLowerCase(), passwordHash, body.role,
        body.department_id || null, body.is_active ?? null],
    ));
  } catch (err) {
    translateUniqueViolation(err);
  }
  await writeAudit(client, {
    userId: admin.user_id, entityType: 'app_user', entityId: user.user_id, action: 'create',
    newValue: { ...userAuditView(user), ...auditExtra },
  });
  return userAuditView(user);
}

async function createUser(admin, body) {
  return withTransaction((client) => insertUser(client, admin, body));
}

async function updateUser(admin, userId, body) {
  return withTransaction(async (client) => {
    const { rows: [current] } = await client.query('SELECT * FROM app_user WHERE user_id = $1 FOR UPDATE', [userId]);
    if (!current) throw new AppError(404, 'User not found');
    if (userId === admin.user_id && (body.is_active === false || (body.role && body.role !== 'admin'))) {
      throw new AppError(409, 'Admins cannot deactivate or demote their own account');
    }

    const next = {
      full_name: body.full_name ?? current.full_name,
      email: body.email ? body.email.toLowerCase() : current.email,
      role: body.role ?? current.role,
      department_id: 'department_id' in body ? body.department_id : current.department_id,
      is_active: body.is_active ?? current.is_active,
      password_hash: body.password ? await bcrypt.hash(body.password, BCRYPT_ROUNDS) : current.password_hash,
    };
    await assertRoleDepartment(client, next.role, next.department_id);

    let updated;
    try {
      ({ rows: [updated] } = await client.query(
        `UPDATE app_user SET full_name = $2, email = $3, role = $4, department_id = $5, is_active = $6, password_hash = $7
          WHERE user_id = $1 RETURNING *`,
        [userId, next.full_name, next.email, next.role, next.department_id, next.is_active, next.password_hash],
      ));
    } catch (err) {
      translateUniqueViolation(err);
    }
    const action = current.is_active && !updated.is_active ? 'deactivate'
      : !current.is_active && updated.is_active ? 'reactivate' : 'update';
    await writeAudit(client, {
      userId: admin.user_id, entityType: 'app_user', entityId: userId, action,
      previousValue: userAuditView(current),
      newValue: { ...userAuditView(updated), ...(body.password && { password_changed: true }) },
    });
    return userAuditView(updated);
  });
}

// Accounts are never hard-deleted: they are referenced by records and the
// audit trail (FKs are ON DELETE RESTRICT). "Delete" means deactivate.
async function deactivateUser(admin, userId) {
  return updateUser(admin, userId, { is_active: false });
}

// ---- Departments & templates ----------------------------------------------

async function listDepartments() {
  const { rows } = await pool.query(
    `SELECT d.department_id, d.code, d.name, d.template_id, t.version AS template_version
       FROM department d LEFT JOIN handover_template t ON t.template_id = d.template_id
      ORDER BY d.name`,
  );
  return rows;
}

async function findDepartment(db, code, lock = false) {
  const { rows: [dept] } = await db.query(
    `SELECT * FROM department WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [code],
  );
  if (!dept) throw new AppError(404, `Unknown department '${code}'`);
  return dept;
}

async function listVersions(db, code) {
  const { rows } = await db.query(
    'SELECT * FROM handover_template WHERE department_code = $1 ORDER BY version DESC',
    [code],
  );
  return rows;
}

// Current template (or ?version=n) plus the full version history.
async function getTemplate(code, version) {
  const dept = await findDepartment(pool, code);
  const versions = await listVersions(pool, code);
  const selected = version
    ? versions.find((v) => v.version === Number(version))
    : versions.find((v) => v.template_id === dept.template_id);
  if (!selected) throw new AppError(404, version ? `Version ${version} not found for '${code}'` : 'Department has no template');
  return {
    department: { department_id: dept.department_id, code: dept.code, name: dept.name },
    current_version: versions.find((v) => v.template_id === dept.template_id)?.version ?? null,
    template: selected,
    versions,
  };
}

// Never overwrites: inserts version N+1 and repoints the department to it.
async function updateTemplate(admin, code, fieldDefinition) {
  const problems = checkFieldDefinition(fieldDefinition);
  if (problems.length) throw new AppError(400, 'Invalid field_definition', problems);

  return withTransaction(async (client) => {
    const dept = await findDepartment(client, code, true);
    const { rows: [current] } = await client.query(
      'SELECT * FROM handover_template WHERE template_id = $1',
      [dept.template_id],
    );

    if (current) {
      const { rows: [{ same }] } = await client.query('SELECT $1::jsonb = $2::jsonb AS same', [
        JSON.stringify(current.field_definition), JSON.stringify(fieldDefinition),
      ]);
      if (same) return { changed: false, template: current };
    }

    const { rows: [{ next }] } = await client.query(
      'SELECT COALESCE(max(version), 0) + 1 AS next FROM handover_template WHERE department_code = $1',
      [code],
    );
    const { rows: [created] } = await client.query(
      `INSERT INTO handover_template (department_code, field_definition, version)
       VALUES ($1, $2, $3) RETURNING *`,
      [code, JSON.stringify(fieldDefinition), next],
    );
    await client.query('UPDATE department SET template_id = $2 WHERE department_id = $1', [dept.department_id, created.template_id]);

    await writeAudit(client, {
      userId: admin.user_id, entityType: 'handover_template', entityId: created.template_id, action: 'create',
      previousValue: current || null, newValue: created,
    });
    await writeAudit(client, {
      userId: admin.user_id, entityType: 'department', entityId: dept.department_id, action: 'update_template',
      previousValue: { template_id: dept.template_id, version: current?.version ?? null },
      newValue: { template_id: created.template_id, version: created.version },
    });
    return { changed: true, template: created };
  });
}

module.exports = {
  listUsers, getUser, createUser, insertUser, updateUser, deactivateUser,
  listDepartments, getTemplate, updateTemplate,
};

const crypto = require('crypto');
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { insertUser } = require('../admin/admin.service');

const REQUEST_COLUMNS = `ar.request_id, ar.full_name, ar.email, ar.staff_number, ar.requested_department_code,
                         d.name AS requested_department_name, ar.note, ar.status, ar.reviewed_by,
                         rv.full_name AS reviewed_by_name, ar.reviewed_at, ar.review_reason, ar.user_id, ar.created_at`;
const REQUEST_SELECT = `SELECT ${REQUEST_COLUMNS}
                          FROM access_request ar
                          JOIN department d ON d.code = ar.requested_department_code
                          LEFT JOIN app_user rv ON rv.user_id = ar.reviewed_by`;

// Departments a requester can choose from (public: code and name only).
async function listRequestableDepartments() {
  const { rows } = await pool.query('SELECT code, name FROM department ORDER BY name');
  return rows;
}

// Public submission. Records the request only: no account is created and no
// access is granted. The requester cannot choose a role.
async function submit(body) {
  return withTransaction(async (client) => {
    const { rows: [dept] } = await client.query('SELECT 1 FROM department WHERE code = $1', [body.requested_department_code]);
    if (!dept) throw new AppError(400, 'Validation failed', [{ field: 'requested_department_code', message: 'Unknown department' }]);

    let request;
    try {
      ({ rows: [request] } = await client.query(
        `INSERT INTO access_request (full_name, email, staff_number, requested_department_code, note)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [body.full_name, body.email.toLowerCase(), body.staff_number || null, body.requested_department_code, body.note || null],
      ));
    } catch (err) {
      if (err.code === '23505') throw new AppError(409, 'A request for this email address is already awaiting review');
      throw err;
    }
    // Anonymous actor: audit_log.user_id is null for public submissions.
    await writeAudit(client, {
      userId: null, entityType: 'access_request', entityId: request.request_id, action: 'create', newValue: request,
    });
    return { request_id: request.request_id, status: request.status, created_at: request.created_at };
  });
}

async function list({ status = 'pending' }) {
  const { rows } = await pool.query(
    `${REQUEST_SELECT}
      WHERE ($1::access_request_status_enum IS NULL OR ar.status = $1)
      ORDER BY ar.created_at ${status === 'pending' ? 'ASC' : 'DESC'}`,
    [status === 'all' ? null : status],
  );
  return rows;
}

async function lockPending(client, requestId) {
  const { rows: [request] } = await client.query('SELECT * FROM access_request WHERE request_id = $1 FOR UPDATE', [requestId]);
  if (!request) throw new AppError(404, 'Access request not found');
  if (request.status !== 'pending') throw new AppError(409, `Access request has already been ${request.status}`);
  return request;
}

// 14 characters from an unambiguous alphabet; shown to the admin once.
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(14), (b) => alphabet[b % alphabet.length]).join('');
}

// Admin decides role and department; the request only supplies identity.
async function approve(admin, requestId, { role, department_id: departmentId, staff_number: staffNumber }) {
  return withTransaction(async (client) => {
    const request = await lockPending(client, requestId);
    const finalStaffNumber = staffNumber || request.staff_number;
    if (!finalStaffNumber) {
      throw new AppError(400, 'Validation failed', [{ field: 'staff_number', message: 'staff_number is required because the request did not include one' }]);
    }

    const password = temporaryPassword();
    const user = await insertUser(client, admin, {
      staff_number: finalStaffNumber, full_name: request.full_name, email: request.email, password, role, department_id: departmentId,
    }, { source: 'access_request', request_id: requestId });

    const { rows: [updated] } = await client.query(
      `UPDATE access_request SET status = 'approved', reviewed_by = $2, reviewed_at = now(), user_id = $3
        WHERE request_id = $1 RETURNING *`,
      [requestId, admin.user_id, user.user_id],
    );
    await writeAudit(client, {
      userId: admin.user_id, entityType: 'access_request', entityId: requestId, action: 'approve',
      previousValue: request, newValue: updated,
    });
    return { request: updated, user, temporary_password: password };
  });
}

async function reject(admin, requestId, { reason }) {
  return withTransaction(async (client) => {
    const request = await lockPending(client, requestId);
    const { rows: [updated] } = await client.query(
      `UPDATE access_request SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), review_reason = $3
        WHERE request_id = $1 RETURNING *`,
      [requestId, admin.user_id, reason || null],
    );
    await writeAudit(client, {
      userId: admin.user_id, entityType: 'access_request', entityId: requestId, action: 'reject',
      previousValue: request, newValue: updated,
    });
    return { request: updated };
  });
}

module.exports = {
  listRequestableDepartments, submit, list, approve, reject,
};

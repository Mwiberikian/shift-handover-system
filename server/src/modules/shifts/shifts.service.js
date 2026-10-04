const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { assertDepartmentAccess } = require('../../middleware/auth');

const ASSIGNED = `COALESCE((
    SELECT json_agg(json_build_object('user_id', u.user_id, 'full_name', u.full_name, 'role', u.role) ORDER BY u.full_name)
      FROM shift_assignment sa JOIN app_user u ON u.user_id = sa.user_id
     WHERE sa.shift_id = s.shift_id), '[]'::json) AS assigned`;

// Shifts from 12 h ago (so the current one shows) to 7 days ahead, for the
// supervisor's department or, for admins, any/all departments.
async function list(user, { department_id: departmentId, from, to }) {
  const dept = user.role === 'admin' ? (departmentId || null) : user.department_id;
  const { rows } = await pool.query(
    `SELECT s.shift_id, s.shift_type, s.start_time, s.end_time, s.department_id, d.name AS department_name, ${ASSIGNED}
       FROM shift s JOIN department d ON d.department_id = s.department_id
      WHERE ($1::uuid IS NULL OR s.department_id = $1)
        AND s.end_time > COALESCE($2::timestamptz, now() - interval '12 hours')
        AND s.start_time < COALESCE($3::timestamptz, now() + interval '7 days')
      ORDER BY s.start_time, d.name`,
    [dept, from || null, to || null],
  );
  return rows;
}

async function findShift(db, shiftId, lock = false) {
  const { rows: [shift] } = await db.query(
    `SELECT s.*, d.name AS department_name FROM shift s JOIN department d ON d.department_id = s.department_id
      WHERE s.shift_id = $1 ${lock ? 'FOR UPDATE OF s' : ''}`,
    [shiftId],
  );
  if (!shift) throw new AppError(404, 'Shift not found');
  return shift;
}

const candidatesFor = async (db, departmentId) => (await db.query(
  `SELECT user_id, full_name, role FROM app_user
    WHERE department_id = $1 AND is_active AND role <> 'admin'
    ORDER BY full_name`,
  [departmentId],
)).rows;

const assignedTo = async (db, shiftId) => (await db.query(
  `SELECT u.user_id, u.full_name, u.role FROM shift_assignment sa JOIN app_user u ON u.user_id = sa.user_id
    WHERE sa.shift_id = $1 ORDER BY u.full_name`,
  [shiftId],
)).rows;

async function getAssignments(user, shiftId) {
  const shift = await findShift(pool, shiftId);
  assertDepartmentAccess(user, shift.department_id);
  return {
    shift,
    assigned: await assignedTo(pool, shiftId),
    candidates: await candidatesFor(pool, shift.department_id),
  };
}

// Replaces the shift's roster. Only active, non-admin staff of the shift's
// department can be assigned.
async function setAssignments(user, shiftId, userIds) {
  const ids = [...new Set(userIds)];
  return withTransaction(async (client) => {
    const shift = await findShift(client, shiftId, true);
    assertDepartmentAccess(user, shift.department_id);
    const allowed = new Set((await candidatesFor(client, shift.department_id)).map((c) => c.user_id));
    const invalid = ids.filter((id) => !allowed.has(id));
    if (invalid.length) {
      throw new AppError(400, 'Only active staff of this shift\'s department can be assigned', invalid.map((id) => ({ field: 'user_ids', message: `${id} is not eligible` })));
    }
    const before = await assignedTo(client, shiftId);
    await client.query('DELETE FROM shift_assignment WHERE shift_id = $1 AND NOT (user_id = ANY($2::uuid[]))', [shiftId, ids]);
    await client.query(
      'INSERT INTO shift_assignment (shift_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING',
      [shiftId, ids],
    );
    const after = await assignedTo(client, shiftId);
    await writeAudit(client, {
      userId: user.user_id, entityType: 'shift', entityId: shiftId, action: 'update_assignments',
      previousValue: { user_ids: before.map((u) => u.user_id) }, newValue: { user_ids: after.map((u) => u.user_id) },
    });
    return { shift, assigned: after };
  });
}

// The caller's current and next rostered shift, with the handover status for
// each (null when no record exists yet). Drives the dashboard shift banner.
async function mine(user) {
  const { rows } = await pool.query(
    `SELECT s.shift_id, s.shift_type, s.start_time, s.end_time, d.name AS department_name,
            (SELECT r.status FROM handover_record r WHERE r.shift_id = s.shift_id
              ORDER BY (r.status = 'closed'), r.created_at DESC LIMIT 1) AS handover_status
       FROM shift_assignment sa
       JOIN shift s ON s.shift_id = sa.shift_id
       JOIN department d ON d.department_id = s.department_id
      WHERE sa.user_id = $1 AND s.end_time > now()
      ORDER BY s.start_time
      LIMIT 2`,
    [user.user_id],
  );
  const current = rows.find((s) => new Date(s.start_time) <= new Date()) ?? null;
  const next = rows.find((s) => new Date(s.start_time) > new Date()) ?? null;
  return { now: new Date().toISOString(), current, next };
}

module.exports = {
  list, getAssignments, setAssignments, mine,
};

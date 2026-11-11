// Supervisor controls (Phase 1): start or end an employee's work session and
// switch an employee between the two staff duties. Supervisors act inside
// their own department, admins anywhere; every action writes an audit entry
// naming who acted and on whom, and notifies the employee in-app.
//
// Sessions reuse sessions.service (start/end with { actor }), so every rule
// that applies to a self-started session still applies: one active session
// per user, the employee must be rostered on the current shift, rows are
// append-only, and task timers stop with the session.
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { assertDepartmentAccess } = require('../../middleware/auth');
const { notify } = require('../notifications/notify');
const sessions = require('../sessions/sessions.service');

const WORKER_ROLES = ['outgoing_staff', 'incoming_staff'];
const ROLE_LABELS = { outgoing_staff: 'Outgoing staff', incoming_staff: 'Incoming staff' };

// The target of a control action: an outgoing/incoming staff member of a
// department the actor manages. Other roles get 404 (as the live board's
// workerDetail does), another department 403.
async function findWorker(db, actor, userId, { lock = false } = {}) {
  const { rows: [worker] } = await db.query(
    `SELECT user_id, full_name, staff_number, role, department_id, is_active
       FROM app_user WHERE user_id = $1 ${lock ? 'FOR UPDATE' : ''}`,
    [userId],
  );
  if (!worker || !WORKER_ROLES.includes(worker.role)) throw new AppError(404, 'Worker not found');
  assertDepartmentAccess(actor, worker.department_id);
  return worker;
}

// req.user carries no name; notifications and audits read better with one.
async function actorWithName(actor) {
  const { rows: [row] } = await pool.query('SELECT full_name FROM app_user WHERE user_id = $1', [actor.user_id]);
  return { ...actor, full_name: row?.full_name ?? null };
}

// POST /api/supervisor/live/:userId/session/start
async function startSession(actor, userId) {
  const worker = await findWorker(pool, actor, userId);
  if (!worker.is_active) throw new AppError(409, 'This account is inactive, so a session cannot start.', { code: 'inactive_user' });
  const result = await sessions.start(worker, { actor: await actorWithName(actor) });
  if (!result.created) throw new AppError(409, 'A session is already running for this employee.', { code: 'session_already_active' });
  return result;
}

// POST /api/supervisor/live/:userId/session/end
async function endSession(actor, userId) {
  const worker = await findWorker(pool, actor, userId);
  return sessions.end(worker, { actor: await actorWithName(actor) });
}

// POST /api/supervisor/users/:userId/role
//
// INTERIM CONTROL: swaps an employee between outgoing_staff and
// incoming_staff only (the routes validate the target role), never the actor
// themselves and never to supervisor or admin. It exists until duty is
// derived from the roster itself (planned roster-based duty); keep it small
// and do not extend it. The role change invalidates the employee's token on
// their next request (middleware/auth.js re-checks role per request), so
// they sign in again; the note they then see on their next page load is the
// 'role_changed' in-app notification written here.
async function switchRole(actor, userId, role) {
  if (userId === actor.user_id) throw new AppError(409, 'You cannot change your own role');
  return withTransaction(async (client) => {
    const worker = await findWorker(client, actor, userId, { lock: true });
    if (!worker.is_active) throw new AppError(409, 'This account is inactive; reactivate it before changing its duty.', { code: 'inactive_user' });
    if (worker.role === role) return { changed: false, user_id: worker.user_id, role };

    await client.query('UPDATE app_user SET role = $2 WHERE user_id = $1', [userId, role]);
    await writeAudit(client, {
      userId: actor.user_id, entityType: 'app_user', entityId: userId, action: 'switch_role',
      previousValue: { role: worker.role },
      newValue: { role, for_user_id: userId, by_user_id: actor.user_id },
    });
    const by = await actorWithName(actor);
    await notify({
      userIds: [userId],
      type: 'role_changed',
      title: `Your duty is now ${ROLE_LABELS[role].toLowerCase()}`,
      body: `${by.full_name ?? 'Your supervisor'} moved you to ${ROLE_LABELS[role].toLowerCase()} duty. You were signed out; sign in again to continue.`,
    }, { db: client });
    return { changed: true, user_id: userId, role };
  });
}

module.exports = { startSession, endSession, switchRole };

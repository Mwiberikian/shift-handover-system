// Supervisor live board (Part M4).
//
// GET /api/supervisor/live: every worker rostered on the department's shift
// that is on now, with their state, session time, current task and timer,
// task counts, last activity and incidents, plus department totals.
// GET /api/supervisor/live/:userId: one worker's tasks with time spent on
// each, and a timeline of their sessions, timers and recorded actions on
// that shift.
//
// Supervisors see their own department; admins any (?department_id, default
// the first department by name). Workers get 403 (in the routes).
//
// State, first match wins:
//   handover_submitted  their handover record for this shift is past draft;
//   working             a session is running with a heartbeat in the last 2 min;
//   idle                a session is running, no heartbeat for 2 min or more;
//   ended               a session on this shift has ended;
//   not_started         no session on this shift.
// Times come from the database clock; server_now lets the client tick timers.
// The board only reads: stale sessions are ended by the jobs tick.
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { SESSION } = require('../../config/constants');

const ms = (expr) => `(EXTRACT(EPOCH FROM (${expr})) * 1000)::bigint`;
const num = (v) => (v === null || v === undefined ? null : Number(v));

async function resolveDepartment(db, user, departmentId) {
  if (user.role === 'supervisor') {
    if (departmentId && departmentId !== user.department_id) throw new AppError(403, 'Resource belongs to another department');
    departmentId = user.department_id;
  }
  const { rows: departments } = await db.query('SELECT department_id, name, code FROM department ORDER BY name');
  const department = departmentId ? departments.find((d) => d.department_id === departmentId) : departments[0];
  if (!department) throw new AppError(404, 'Department not found');
  return { department, departments: user.role === 'admin' ? departments : undefined };
}

async function currentShift(db, departmentId) {
  const { rows: [shift] } = await db.query(
    `SELECT shift_id, shift_type, start_time, end_time FROM shift
      WHERE department_id = $1 AND start_time <= now() AND end_time > now()
      ORDER BY start_time DESC LIMIT 1`,
    [departmentId],
  );
  return shift || null;
}

function stateOf(w) {
  if (w.handover_status && w.handover_status !== 'draft') return 'handover_submitted';
  if (w.session && !w.session.ended_at) return w.session.heartbeat_age_ms >= SESSION.idleAfterMinutes * 60000 ? 'idle' : 'working';
  if (w.session) return 'ended';
  return 'not_started';
}

const STATES = ['working', 'idle', 'not_started', 'ended', 'handover_submitted'];

async function board(user, { department_id: departmentId } = {}) {
  const { department, departments } = await resolveDepartment(pool, user, departmentId);
  const { rows: [{ now }] } = await pool.query('SELECT now()');
  const shift = await currentShift(pool, department.department_id);
  const base = {
    server_now: now, department, departments, shift, idle_after_minutes: SESSION.idleAfterMinutes,
  };
  if (!shift) return { ...base, workers: [], totals: totals([]) };

  // One query per concern, each for the whole roster.
  const { rows: people } = await pool.query(
    `SELECT u.user_id, u.full_name, u.staff_number, u.role
       FROM shift_assignment sa JOIN app_user u ON u.user_id = sa.user_id
      WHERE sa.shift_id = $1 AND u.is_active
      ORDER BY u.role DESC, u.full_name`,
    [shift.shift_id],
  );
  const ids = people.map((p) => p.user_id);
  const [sessions, timers, tasks, records, activity, incidents] = await Promise.all([
    // The latest session of each worker on this shift.
    pool.query(
      `SELECT DISTINCT ON (ws.user_id) ws.user_id, ws.session_id, ws.started_at, ws.ended_at, ws.end_reason, ws.last_heartbeat_at,
              ${ms('COALESCE(ws.ended_at, now()) - ws.started_at')} AS elapsed_ms,
              ${ms('now() - ws.last_heartbeat_at')} AS heartbeat_age_ms
         FROM work_session ws WHERE ws.shift_id = $1 AND ws.user_id = ANY($2::uuid[])
        ORDER BY ws.user_id, ws.started_at DESC`,
      [shift.shift_id, ids],
    ),
    pool.query(
      `SELECT t.user_id, t.task_id, k.description, t.started_at, ${ms('now() - t.started_at')} AS elapsed_ms
         FROM task_timer t JOIN task k ON k.task_id = t.task_id
        WHERE t.stopped_at IS NULL AND t.user_id = ANY($1::uuid[])`,
      [ids],
    ),
    // Tasks on this shift's handover records the worker hands over or receives.
    pool.query(
      `SELECT p.user_id, k.status, count(*)::int AS n
         FROM unnest($2::uuid[]) AS p(user_id)
         JOIN handover_record r ON r.shift_id = $1 AND p.user_id IN (r.outgoing_user_id, r.incoming_user_id)
         JOIN task k ON k.record_id = r.record_id
        GROUP BY p.user_id, k.status`,
      [shift.shift_id, ids],
    ),
    pool.query(
      'SELECT outgoing_user_id AS user_id, status FROM handover_record WHERE shift_id = $1 AND outgoing_user_id = ANY($2::uuid[])',
      [shift.shift_id, ids],
    ),
    pool.query(
      `SELECT user_id, max(logged_at) AS at FROM audit_log
        WHERE user_id = ANY($1::uuid[]) AND logged_at >= $2 GROUP BY user_id`,
      [ids, shift.start_time],
    ),
    pool.query(
      `SELECT i.reported_by AS user_id, count(*)::int AS n
         FROM incident i JOIN handover_record r ON r.record_id = i.record_id
        WHERE r.shift_id = $1 AND i.reported_by = ANY($2::uuid[]) GROUP BY i.reported_by`,
      [shift.shift_id, ids],
    ),
  ]);
  const by = (rows) => Object.fromEntries(rows.map((r) => [r.user_id, r]));
  const sessionBy = by(sessions.rows);
  const timerBy = by(timers.rows);
  const recordBy = by(records.rows);
  const activityBy = by(activity.rows);
  const incidentBy = by(incidents.rows);

  const workers = people.map((p) => {
    const s = sessionBy[p.user_id];
    const t = timerBy[p.user_id];
    const counts = { open: 0, in_progress: 0, resolved: 0 };
    for (const row of tasks.rows) if (row.user_id === p.user_id) counts[row.status] = row.n;
    const session = s ? {
      session_id: s.session_id, started_at: s.started_at, ended_at: s.ended_at, end_reason: s.end_reason,
      last_heartbeat_at: s.last_heartbeat_at, elapsed_ms: num(s.elapsed_ms), heartbeat_age_ms: num(s.heartbeat_age_ms),
    } : null;
    const lastActivity = [s?.last_heartbeat_at, activityBy[p.user_id]?.at].filter(Boolean).sort((a, b) => b - a)[0] ?? null;
    const worker = {
      ...p,
      session,
      current_task: t ? {
        task_id: t.task_id, description: t.description, timer_started_at: t.started_at, elapsed_ms: num(t.elapsed_ms),
      } : null,
      tasks: counts,
      handover_status: recordBy[p.user_id]?.status ?? null,
      last_activity_at: lastActivity,
      incident_count: incidentBy[p.user_id]?.n ?? 0,
    };
    return { ...worker, state: stateOf(worker) };
  });
  return { ...base, workers, totals: totals(workers) };
}

function totals(workers) {
  const out = { workers: workers.length, open: 0, in_progress: 0, resolved: 0, incidents: 0 };
  for (const s of STATES) out[s] = 0;
  for (const w of workers) {
    out[w.state] += 1;
    out.open += w.tasks.open;
    out.in_progress += w.tasks.in_progress;
    out.resolved += w.tasks.resolved;
    out.incidents += w.incident_count;
  }
  return out;
}

// GET /api/supervisor/live/:userId
async function workerDetail(user, userId) {
  const { rows: [worker] } = await pool.query(
    `SELECT u.user_id, u.full_name, u.staff_number, u.role, u.department_id, d.name AS department_name
       FROM app_user u LEFT JOIN department d ON d.department_id = u.department_id WHERE u.user_id = $1`,
    [userId],
  );
  if (!worker || !['outgoing_staff', 'incoming_staff'].includes(worker.role)) throw new AppError(404, 'Worker not found');
  if (user.role === 'supervisor' && worker.department_id !== user.department_id) throw new AppError(403, 'Resource belongs to another department');

  const { rows: [{ now }] } = await pool.query('SELECT now()');
  // The shift on now if they are rostered on it, else their latest session's shift.
  const { rows: [shift] } = await pool.query(
    `SELECT s.shift_id, s.shift_type, s.start_time, s.end_time FROM shift s
      WHERE s.shift_id = COALESCE(
        (SELECT sa.shift_id FROM shift_assignment sa JOIN shift x ON x.shift_id = sa.shift_id
          WHERE sa.user_id = $1 AND x.start_time <= now() AND x.end_time > now() ORDER BY x.start_time DESC LIMIT 1),
        (SELECT shift_id FROM work_session WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1))`,
    [userId],
  );
  const result = {
    server_now: now, worker, shift: shift || null, sessions: [], tasks: [], timeline: [],
  };
  if (!shift) return result;

  const { rows: sessions } = await pool.query(
    `SELECT session_id, started_at, ended_at, end_reason, last_heartbeat_at, ${ms('COALESCE(ended_at, now()) - started_at')} AS elapsed_ms
       FROM work_session WHERE user_id = $1 AND shift_id = $2 ORDER BY started_at`,
    [userId, shift.shift_id],
  );
  const { rows: timers } = await pool.query(
    `SELECT t.timer_id, t.task_id, k.description, k.status, t.started_at, t.stopped_at,
            ${ms('COALESCE(t.stopped_at, now()) - t.started_at')} AS elapsed_ms
       FROM task_timer t JOIN task k ON k.task_id = t.task_id
      WHERE t.session_id = ANY($1::uuid[]) ORDER BY t.started_at`,
    [sessions.map((s) => s.session_id)],
  );
  const { rows: actions } = await pool.query(
    `SELECT logged_at, entity_type, action FROM audit_log
      WHERE user_id = $1 AND logged_at >= $2 AND logged_at < $3::timestamptz + interval '1 hour'
        AND entity_type <> 'work_session' AND action <> 'read'
      ORDER BY logged_at`,
    [userId, shift.start_time, shift.end_time],
  );

  const tasks = new Map();
  for (const t of timers) {
    const entry = tasks.get(t.task_id) ?? {
      task_id: t.task_id, description: t.description, status: t.status, total_ms: 0, timers: 0, running: false,
    };
    entry.total_ms += Number(t.elapsed_ms);
    entry.timers += 1;
    entry.running ||= t.stopped_at === null;
    tasks.set(t.task_id, entry);
  }

  const timeline = [
    ...sessions.flatMap((s) => [
      { at: s.started_at, kind: 'session_start', label: 'Started shift' },
      ...(s.ended_at ? [{ at: s.ended_at, kind: 'session_end', label: { manual: 'Ended shift', heartbeat: 'Session timed out (no heartbeat)', shift_end: 'Session closed after the shift ended' }[s.end_reason] }] : []),
    ]),
    ...timers.flatMap((t) => [
      { at: t.started_at, kind: 'timer_start', label: `Started timing: ${t.description}` },
      ...(t.stopped_at ? [{ at: t.stopped_at, kind: 'timer_stop', label: `Stopped timing: ${t.description}` }] : []),
    ]),
    ...actions.map((a) => ({ at: a.logged_at, kind: 'action', label: `${a.action.replace(/_/g, ' ')} ${a.entity_type.replace(/_/g, ' ')}` })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at));

  return {
    ...result,
    sessions: sessions.map((s) => ({ ...s, elapsed_ms: Number(s.elapsed_ms) })),
    tasks: [...tasks.values()].sort((a, b) => b.total_ms - a.total_ms),
    timeline,
  };
}

module.exports = { board, workerDetail, STATES };

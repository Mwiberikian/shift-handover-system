// Work sessions and task timers (Part M3).
//
// A session runs from "Start shift" to "End shift", or until it is ended
// automatically: 10 minutes without a heartbeat (ended at the last
// heartbeat) or 30 minutes after the shift's end (ended at that moment).
// The jobs tick applies both rules (jobs/sessions.js); a heartbeat or start
// that arrives late applies them first, so a stale session never comes back
// to life. Every time is the database's clock, never the client's. Responses
// carry server_now so the client can tick timers without clock drift.
//
// A timer measures time on one of the user's own tasks on their current
// draft handover record, inside their active session. Starting a timer stops
// the running one. Ending a session, or submitting the handover, stops it.
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { SESSION } = require('../../config/constants');

const ms = (expr) => `(EXTRACT(EPOCH FROM (${expr})) * 1000)::bigint`;

// The session rows that should have ended by `now` ($1), with when and why.
// The earlier of the two rules wins.
const STALE_SESSIONS = `
  SELECT ws.session_id,
         CASE WHEN ws.last_heartbeat_at <= s.end_time + make_interval(mins => ${SESSION.shiftEndGraceMinutes})
                AND ws.last_heartbeat_at <= $1::timestamptz - make_interval(mins => ${SESSION.heartbeatTimeoutMinutes})
              THEN ws.last_heartbeat_at
              ELSE s.end_time + make_interval(mins => ${SESSION.shiftEndGraceMinutes}) END AS ended_at,
         CASE WHEN ws.last_heartbeat_at <= s.end_time + make_interval(mins => ${SESSION.shiftEndGraceMinutes})
                AND ws.last_heartbeat_at <= $1::timestamptz - make_interval(mins => ${SESSION.heartbeatTimeoutMinutes})
              THEN 'heartbeat' ELSE 'shift_end' END::session_end_reason_enum AS end_reason
    FROM work_session ws JOIN shift s ON s.shift_id = ws.shift_id
   WHERE ws.ended_at IS NULL
     AND (ws.last_heartbeat_at <= $1::timestamptz - make_interval(mins => ${SESSION.heartbeatTimeoutMinutes})
       OR s.end_time + make_interval(mins => ${SESSION.shiftEndGraceMinutes}) <= $1::timestamptz)`;

// Ends every stale session (optionally only `userId`'s) at `now`, and stops
// the timers of every ended session. Returns the sessions it ended.
async function expireStale(db, now, userId = null) {
  const { rows } = await db.query(
    `UPDATE work_session ws SET ended_at = x.ended_at, end_reason = x.end_reason
       FROM (${STALE_SESSIONS} AND ($2::uuid IS NULL OR ws.user_id = $2)) x
      WHERE ws.session_id = x.session_id AND ws.ended_at IS NULL
      RETURNING ws.*`,
    [now, userId],
  );
  await stopTimersOfEndedSessions(db);
  return rows;
}

// A timer never outlives its session: stopped when the session ended.
async function stopTimersOfEndedSessions(db) {
  const { rowCount } = await db.query(
    `UPDATE task_timer t SET stopped_at = GREATEST(t.started_at, ws.ended_at)
       FROM work_session ws
      WHERE ws.session_id = t.session_id AND t.stopped_at IS NULL AND ws.ended_at IS NOT NULL`,
  );
  return rowCount;
}

// Stops running timers on a record's tasks (called when it is submitted, in
// the submit transaction). `at` defaults to the transaction's now().
async function stopTimersForRecord(db, recordId, at = null) {
  const { rowCount } = await db.query(
    `UPDATE task_timer t SET stopped_at = GREATEST(t.started_at, COALESCE($2::timestamptz, now()))
       FROM task k
      WHERE k.task_id = t.task_id AND k.record_id = $1 AND t.stopped_at IS NULL`,
    [recordId, at],
  );
  return rowCount;
}

// Safety net for the jobs tick: timers on tasks whose record is no longer a
// draft stop at the submission time.
async function stopTimersOfSubmittedRecords(db) {
  const { rowCount } = await db.query(
    `UPDATE task_timer t SET stopped_at = GREATEST(t.started_at, COALESCE(r.submitted_at, now()))
       FROM task k JOIN handover_record r ON r.record_id = k.record_id
      WHERE k.task_id = t.task_id AND t.stopped_at IS NULL AND r.status <> 'draft'`,
  );
  return rowCount;
}

const SESSION_SELECT = `
  SELECT ws.session_id, ws.user_id, ws.shift_id, ws.started_at, ws.ended_at, ws.end_reason, ws.last_heartbeat_at,
         s.shift_type, s.start_time AS shift_start, s.end_time AS shift_end, d.name AS department_name,
         ${ms('COALESCE(ws.ended_at, now()) - ws.started_at')} AS elapsed_ms
    FROM work_session ws
    JOIN shift s ON s.shift_id = ws.shift_id
    JOIN department d ON d.department_id = s.department_id`;

const TIMER_SELECT = `
  SELECT t.timer_id, t.session_id, t.task_id, t.started_at, t.stopped_at, k.description, k.status AS task_status,
         ${ms('COALESCE(t.stopped_at, now()) - t.started_at')} AS elapsed_ms
    FROM task_timer t JOIN task k ON k.task_id = t.task_id`;

const toInt = (row) => row && { ...row, elapsed_ms: Number(row.elapsed_ms) };

async function serverNow(db) {
  const { rows: [{ now }] } = await db.query('SELECT now()');
  return now;
}

async function activeSession(db, userId, lock = false) {
  const { rows: [s] } = await db.query(
    `${SESSION_SELECT} WHERE ws.user_id = $1 AND ws.ended_at IS NULL ${lock ? 'FOR UPDATE OF ws' : ''}`,
    [userId],
  );
  return toInt(s) || null;
}

async function runningTimer(db, userId) {
  const { rows: [t] } = await db.query(`${TIMER_SELECT} WHERE t.user_id = $1 AND t.stopped_at IS NULL`, [userId]);
  return toInt(t) || null;
}

async function state(db, userId) {
  const [now, session, timer] = [await serverNow(db), await activeSession(db, userId), await runningTimer(db, userId)];
  return { server_now: now, session, timer };
}

// The shift the user is rostered on right now, if any.
async function currentAssignedShift(db, userId) {
  const { rows: [s] } = await db.query(
    `SELECT s.* FROM shift_assignment sa JOIN shift s ON s.shift_id = sa.shift_id
      WHERE sa.user_id = $1 AND s.start_time <= now() AND s.end_time > now()
      ORDER BY s.start_time DESC LIMIT 1`,
    [userId],
  );
  return s || null;
}

// POST /api/sessions/start. Returns { created, ...state }.
async function start(user) {
  return withTransaction(async (client) => {
    await expireStale(client, await serverNow(client), user.user_id);
    const existing = await activeSession(client, user.user_id, true);
    if (existing) return { created: false, ...(await state(client, user.user_id)) };

    const shift = await currentAssignedShift(client, user.user_id);
    if (!shift) {
      throw new AppError(409, 'You are not on the roster for a shift that is on now, so a session cannot start. Ask your supervisor to add you to the current shift.', { code: 'no_current_shift' });
    }
    let session;
    try {
      ({ rows: [session] } = await client.query(
        'INSERT INTO work_session (user_id, shift_id) VALUES ($1, $2) RETURNING *',
        [user.user_id, shift.shift_id],
      ));
    } catch (err) {
      if (err.constraint === 'work_session_one_active_per_user') throw new AppError(409, 'A session is already running for you');
      throw err;
    }
    await writeAudit(client, {
      userId: user.user_id, entityType: 'work_session', entityId: session.session_id, action: 'start',
      newValue: { shift_id: shift.shift_id, started_at: session.started_at },
    });
    return { created: true, ...(await state(client, user.user_id)) };
  });
}

// POST /api/sessions/heartbeat. 409 when there is no active session, or when
// it had already timed out: it is then ended (and stays ended, the 409 does
// not roll that back) at its last heartbeat or 30 minutes after the shift.
async function heartbeat(user) {
  const result = await withTransaction(async (client) => {
    const [ended] = await expireStale(client, await serverNow(client), user.user_id);
    if (ended) return { ended };
    const { rowCount } = await client.query(
      'UPDATE work_session SET last_heartbeat_at = GREATEST(last_heartbeat_at, now()) WHERE user_id = $1 AND ended_at IS NULL',
      [user.user_id],
    );
    return rowCount ? state(client, user.user_id) : { none: true };
  });
  if (result.ended) {
    throw new AppError(409, result.ended.end_reason === 'heartbeat'
      ? `Your session ended after ${SESSION.heartbeatTimeoutMinutes} minutes without activity. Start it again to continue.`
      : 'Your shift has ended, so your session was closed.', { code: 'session_ended', end_reason: result.ended.end_reason });
  }
  if (result.none) throw new AppError(409, 'No session is running. Start your shift first.', { code: 'no_active_session' });
  return result;
}

// POST /api/sessions/end
async function end(user) {
  return withTransaction(async (client) => {
    await expireStale(client, await serverNow(client), user.user_id);
    const session = await activeSession(client, user.user_id, true);
    if (!session) throw new AppError(409, 'No session is running.', { code: 'no_active_session' });
    const { rows: [ended] } = await client.query(
      "UPDATE work_session SET ended_at = now(), end_reason = 'manual' WHERE session_id = $1 RETURNING *",
      [session.session_id],
    );
    await stopTimersOfEndedSessions(client);
    await writeAudit(client, {
      userId: user.user_id, entityType: 'work_session', entityId: session.session_id, action: 'end',
      newValue: { ended_at: ended.ended_at, end_reason: 'manual' },
    });
    const { rows: [view] } = await client.query(`${SESSION_SELECT} WHERE ws.session_id = $1`, [session.session_id]);
    return { server_now: await serverNow(client), session: null, timer: null, ended: toInt(view) };
  });
}

// Per-task time in each of the given sessions: { session_id: [{ task_id, description, total_ms, timers }] }
async function taskTotals(db, sessionIds) {
  if (!sessionIds.length) return {};
  const { rows } = await db.query(
    `SELECT t.session_id, t.task_id, k.description, k.status AS task_status, count(*)::int AS timers,
            sum(${ms('COALESCE(t.stopped_at, now()) - t.started_at')})::bigint AS total_ms
       FROM task_timer t JOIN task k ON k.task_id = t.task_id
      WHERE t.session_id = ANY($1::uuid[])
      GROUP BY t.session_id, t.task_id, k.description, k.status
      ORDER BY total_ms DESC`,
    [sessionIds],
  );
  return rows.reduce((acc, r) => {
    (acc[r.session_id] ||= []).push({ ...r, total_ms: Number(r.total_ms) });
    return acc;
  }, {});
}

// GET /api/sessions/mine: the current state plus the user's own history.
async function mine(user, { limit = 30 } = {}) {
  await withTransaction(async (client) => expireStale(client, await serverNow(client), user.user_id));
  const current = await state(pool, user.user_id);
  const { rows } = await pool.query(`${SESSION_SELECT} WHERE ws.user_id = $1 ORDER BY ws.started_at DESC LIMIT $2`, [user.user_id, limit]);
  const totals = await taskTotals(pool, rows.map((r) => r.session_id));
  return {
    ...current,
    history: rows.map((r) => ({ ...toInt(r), tasks: totals[r.session_id] || [] })),
  };
}

// The task, if it is the user's own task on their current draft record.
async function ownDraftTask(db, user, taskId) {
  const { rows: [task] } = await db.query(
    `SELECT k.task_id, k.description, r.record_id, r.status AS record_status, r.outgoing_user_id
       FROM task k JOIN handover_record r ON r.record_id = k.record_id WHERE k.task_id = $1`,
    [taskId],
  );
  if (!task) throw new AppError(404, 'Task not found');
  if (task.outgoing_user_id !== user.user_id) throw new AppError(403, 'You can only time tasks on your own handover');
  if (task.record_status !== 'draft') throw new AppError(409, 'This handover has been submitted; its tasks can no longer be timed');
  return task;
}

// POST /api/tasks/:id/timer/start. Stops the running timer first.
async function startTimer(user, taskId) {
  return withTransaction(async (client) => {
    await expireStale(client, await serverNow(client), user.user_id);
    const session = await activeSession(client, user.user_id, true);
    if (!session) throw new AppError(409, 'Start your shift before timing a task.', { code: 'no_active_session' });
    await ownDraftTask(client, user, taskId);

    const running = await runningTimer(client, user.user_id);
    if (running?.task_id === taskId) return { created: false, ...(await state(client, user.user_id)) };
    if (running) await client.query('UPDATE task_timer SET stopped_at = now() WHERE timer_id = $1', [running.timer_id]);
    await client.query(
      'INSERT INTO task_timer (session_id, task_id, user_id) VALUES ($1, $2, $3)',
      [session.session_id, taskId, user.user_id],
    );
    return { created: true, stopped_timer_id: running?.timer_id ?? null, ...(await state(client, user.user_id)) };
  });
}

// POST /api/tasks/:id/timer/stop
async function stopTimer(user, taskId) {
  return withTransaction(async (client) => {
    await expireStale(client, await serverNow(client), user.user_id);
    const { rows: [stopped] } = await client.query(
      `UPDATE task_timer SET stopped_at = now()
        WHERE user_id = $1 AND task_id = $2 AND stopped_at IS NULL RETURNING timer_id`,
      [user.user_id, taskId],
    );
    if (!stopped) throw new AppError(409, 'No timer is running for this task.', { code: 'no_running_timer' });
    const { rows: [timer] } = await client.query(`${TIMER_SELECT} WHERE t.timer_id = $1`, [stopped.timer_id]);
    return { ...(await state(client, user.user_id)), stopped: toInt(timer) };
  });
}

module.exports = {
  start, heartbeat, end, mine, startTimer, stopTimer,
  expireStale, stopTimersForRecord, stopTimersOfEndedSessions, stopTimersOfSubmittedRecords,
  activeSession, runningTimer, taskTotals, currentAssignedShift, SESSION_SELECT, TIMER_SELECT,
};

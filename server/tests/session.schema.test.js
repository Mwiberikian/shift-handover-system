// Part M2: work_session and task_timer tables and their triggers, with direct
// SQL (no API).
const { pool, buildWorld } = require('./helpers/fixtures');

let world;
let task;
beforeEach(async () => {
  world = await buildWorld();
  const { rows: [rec] } = await pool.query(
    'INSERT INTO handover_record (shift_id, department_id, outgoing_user_id) VALUES ($1, $2, $3) RETURNING *',
    [world.shifts.dept_a.current.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id],
  );
  ({ rows: [task] } = await pool.query("INSERT INTO task (record_id, description) VALUES ($1, 'Check the GPU on stand 5') RETURNING *", [rec.record_id]));
});
afterAll(() => pool.end());

const rejects = (promise, pattern) => expect(promise).rejects.toThrow(pattern);
const startSession = async (who = 'outA') => (await pool.query(
  'INSERT INTO work_session (user_id, shift_id) VALUES ($1, $2) RETURNING *',
  [world.users[who].user_id, world.shifts.dept_a.current.shift_id],
)).rows[0];
const startTimer = async (session, userId = session.user_id) => (await pool.query(
  'INSERT INTO task_timer (session_id, task_id, user_id) VALUES ($1, $2, $3) RETURNING *',
  [session.session_id, task.task_id, userId],
)).rows[0];

describe('work_session', () => {
  test('one active session per user', async () => {
    const s = await startSession();
    await rejects(startSession(), /work_session_one_active_per_user/);
    await startSession('incA'); // another user is fine
    await pool.query("UPDATE work_session SET ended_at = now(), end_reason = 'manual' WHERE session_id = $1", [s.session_id]);
    await startSession(); // a new one after the first ended
  });

  test('ended_at and end_reason are set once and together; then the row is frozen', async () => {
    const s = await startSession();
    await rejects(pool.query('UPDATE work_session SET ended_at = now() WHERE session_id = $1', [s.session_id]), /work_session_end_together/);
    await pool.query("UPDATE work_session SET ended_at = now(), end_reason = 'manual' WHERE session_id = $1", [s.session_id]);
    await rejects(pool.query("UPDATE work_session SET ended_at = now() + interval '1 hour' WHERE session_id = $1", [s.session_id]), /has ended/);
    await rejects(pool.query("UPDATE work_session SET end_reason = 'heartbeat' WHERE session_id = $1", [s.session_id]), /has ended/);
    await rejects(pool.query("UPDATE work_session SET last_heartbeat_at = now() + interval '1 minute' WHERE session_id = $1", [s.session_id]), /has ended/);
  });

  test('the heartbeat moves forwards only; start, user and shift never change; no deletes', async () => {
    const s = await startSession();
    await pool.query("UPDATE work_session SET last_heartbeat_at = now() + interval '1 minute' WHERE session_id = $1", [s.session_id]);
    await rejects(pool.query('UPDATE work_session SET last_heartbeat_at = started_at WHERE session_id = $1', [s.session_id]), /cannot go backwards/);
    await rejects(pool.query("UPDATE work_session SET started_at = started_at - interval '1 hour' WHERE session_id = $1", [s.session_id]), /only ended_at/);
    await rejects(pool.query('UPDATE work_session SET user_id = $2 WHERE session_id = $1', [s.session_id, world.users.incA.user_id]), /only ended_at/);
    await rejects(pool.query('DELETE FROM work_session WHERE session_id = $1', [s.session_id]), /append-only/);
  });

  test('ended_at cannot be before started_at', async () => {
    const s = await startSession();
    await rejects(pool.query("UPDATE work_session SET ended_at = started_at - interval '1 minute', end_reason = 'manual' WHERE session_id = $1", [s.session_id]), /work_session_time_order/);
  });
});

describe('task_timer', () => {
  test('one running timer per user', async () => {
    const s = await startSession();
    await startTimer(s);
    await rejects(startTimer(s), /task_timer_one_running_per_user/);
  });

  test("needs the same user's active session", async () => {
    const s = await startSession();
    await rejects(startTimer(s, world.users.incA.user_id), /active work session/);
    await pool.query("UPDATE work_session SET ended_at = now(), end_reason = 'manual' WHERE session_id = $1", [s.session_id]);
    await rejects(startTimer(s), /active work session/);
  });

  test('stopped_at is set once; nothing else changes; no deletes', async () => {
    const s = await startSession();
    const t = await startTimer(s);
    await pool.query('UPDATE task_timer SET stopped_at = now() WHERE timer_id = $1', [t.timer_id]);
    await rejects(pool.query("UPDATE task_timer SET stopped_at = now() + interval '1 hour' WHERE timer_id = $1", [t.timer_id]), /only stopped_at can be set, once/);
    await rejects(pool.query("UPDATE task_timer SET started_at = started_at - interval '1 hour' WHERE timer_id = $1", [t.timer_id]), /only stopped_at/);
    await rejects(pool.query('DELETE FROM task_timer WHERE timer_id = $1', [t.timer_id]), /append-only/);
    await startTimer(s); // a new timer once the first has stopped
  });

  test('a timer cannot stop before it started; foreign keys restrict', async () => {
    const s = await startSession();
    const t = await startTimer(s);
    await rejects(pool.query("UPDATE task_timer SET stopped_at = started_at - interval '1 second' WHERE timer_id = $1", [t.timer_id]), /task_timer_time_order/);
    await rejects(pool.query('DELETE FROM task WHERE task_id = $1', [task.task_id]), /task_timer_task_id_fkey/);
  });
});

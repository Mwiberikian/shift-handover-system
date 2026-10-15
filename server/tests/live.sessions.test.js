// Part M6: sessions and timers as the live board reports them - who may see
// the board, one session and one running timer per user even under
// concurrent requests, the automatic ends with a fake clock, timers stopping
// on submit, exact durations, and edits the triggers refuse.
// (Single-request rules are in session.api.test.js and session.schema.test.js.)
const {
  pool, buildWorld, as, createCompleteDraft,
} = require('./helpers/fixtures');
const { runSessionCheck } = require('../src/jobs/sessions');

const MIN = 60 * 1000;
let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const assign = (who, dept = 'dept_a') => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [world.shifts[dept].current.shift_id, world.users[who].user_id],
);
const at = (base, mins) => new Date(new Date(base).getTime() + mins * MIN);
const boardFor = async (who, qs = '') => (await as(world, who).get(`/api/supervisor/live${qs}`)).body;
const workerOn = (board, who) => board.workers.find((w) => w.user_id === world.users[who].user_id);

describe('who sees the board', () => {
  beforeEach(async () => {
    await assign('outA');
    await assign('outB', 'dept_b');
  });

  test.each([
    ['outA', 403, 403], ['incA', 403, 403], ['supA', 200, 200], ['supB', 200, 403], ['admin', 200, 200],
  ])('%s: board %i, outA detail %i', async (who, boardStatus, detailStatus) => {
    expect((await as(world, who).get('/api/supervisor/live')).status).toBe(boardStatus);
    expect((await as(world, who).get(`/api/supervisor/live/${world.users.outA.user_id}`)).status).toBe(detailStatus);
  });

  test('a supervisor\'s board lists only their own department; admins any department', async () => {
    expect((await boardFor('supA')).workers.map((w) => w.full_name)).toEqual(['Test outA']);
    expect((await boardFor('supB')).workers.map((w) => w.full_name)).toEqual(['Test outB']);
    expect((await as(world, 'supB').get(`/api/supervisor/live?department_id=${world.depts.dept_a.department_id}`)).status).toBe(403);
    expect((await boardFor('admin', `?department_id=${world.depts.dept_a.department_id}`)).workers.map((w) => w.full_name)).toEqual(['Test outA']);
    expect((await boardFor('admin', `?department_id=${world.depts.dept_b.department_id}`)).workers.map((w) => w.full_name)).toEqual(['Test outB']);
  });
});

describe('one session and one running timer per user, even when requests race', () => {
  test('five simultaneous starts give one session', async () => {
    await assign('outA');
    const results = await Promise.all(Array.from({ length: 5 }, () => as(world, 'outA').post('/api/sessions/start')));
    expect(results.map((r) => r.status).every((s) => s === 200 || s === 201 || s === 409)).toBe(true);
    const ids = new Set(results.filter((r) => r.status < 300).map((r) => r.body.session.session_id));
    expect(ids.size).toBe(1);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM work_session WHERE user_id = $1', [world.users.outA.user_id]);
    expect(rows[0].n).toBe(1);
    expect(workerOn(await boardFor('supA'), 'outA').state).toBe('working');
  });

  test('timers started at once on different tasks leave exactly one running', async () => {
    await assign('outA');
    await as(world, 'outA').post('/api/sessions/start');
    const record = await createCompleteDraft(world);
    const out = as(world, 'outA');
    const extra = [];
    for (const d of ['Second synthetic task', 'Third synthetic task']) extra.push((await out.post(`/api/handovers/${record.record_id}/tasks`, { description: d })).body);
    const { rows: tasks } = await pool.query('SELECT task_id FROM task WHERE record_id = $1', [record.record_id]);
    await Promise.all(tasks.map((t) => as(world, 'outA').post(`/api/tasks/${t.task_id}/timer/start`)));
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM task_timer WHERE user_id = $1 AND stopped_at IS NULL', [world.users.outA.user_id]);
    expect(rows[0].n).toBe(1);
    const w = workerOn(await boardFor('supA'), 'outA');
    expect(tasks.map((t) => t.task_id)).toContain(w.current_task.task_id);
  });
});

describe('automatic ends with a fake clock, as the board sees them', () => {
  test('no heartbeat for 10 minutes: the board shows the worker ended, at the last heartbeat', async () => {
    await assign('outA');
    const { body: { session } } = await as(world, 'outA').post('/api/sessions/start');
    expect(workerOn(await boardFor('supA'), 'outA').state).toBe('working');

    await runSessionCheck(at(session.last_heartbeat_at, 9)); // not yet
    expect(workerOn(await boardFor('supA'), 'outA').state).toBe('working');
    // (JSON times are to the millisecond, the database's to the microsecond.)
    await runSessionCheck(at(session.last_heartbeat_at, 10.02));
    const w = workerOn(await boardFor('supA'), 'outA');
    expect(w.state).toBe('ended');
    expect(w.session).toMatchObject({ end_reason: 'heartbeat', ended_at: session.last_heartbeat_at });
  });

  test('still beating 30 minutes after the shift: ended at shift end + 30 min', async () => {
    await assign('outA');
    const shift = world.shifts.dept_a.current;
    const { rows: [s] } = await pool.query(
      'INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at) VALUES ($1, $2, $3, $4) RETURNING *',
      [world.users.outA.user_id, shift.shift_id, at(shift.start_time, 5), at(shift.end_time, 25)],
    );
    await runSessionCheck(at(shift.end_time, 29));
    expect((await pool.query('SELECT ended_at FROM work_session WHERE session_id = $1', [s.session_id])).rows[0].ended_at).toBeNull();
    await runSessionCheck(at(shift.end_time, 31));
    const { rows: [row] } = await pool.query('SELECT ended_at, end_reason FROM work_session WHERE session_id = $1', [s.session_id]);
    expect(row).toEqual({ ended_at: at(shift.end_time, 30), end_reason: 'shift_end' });
  });
});

describe('submitting the handover', () => {
  test('stops the running timer at the submission time; the board shows the handover submitted with no current task', async () => {
    await assign('outA');
    await as(world, 'outA').post('/api/sessions/start');
    const record = await createCompleteDraft(world);
    const { rows: [task] } = await pool.query('SELECT task_id FROM task WHERE record_id = $1', [record.record_id]);
    await as(world, 'outA').post(`/api/tasks/${task.task_id}/timer/start`);
    expect(workerOn(await boardFor('supA'), 'outA').current_task.task_id).toBe(task.task_id);

    expect((await as(world, 'outA').post(`/api/handovers/${record.record_id}/submit`)).status).toBe(200);
    const { rows: [timer] } = await pool.query('SELECT stopped_at FROM task_timer WHERE task_id = $1', [task.task_id]);
    const { rows: [rec] } = await pool.query('SELECT submitted_at FROM handover_record WHERE record_id = $1', [record.record_id]);
    expect(timer.stopped_at).toEqual(rec.submitted_at);
    const w = workerOn(await boardFor('supA'), 'outA');
    expect(w).toMatchObject({ state: 'handover_submitted', current_task: null, handover_status: 'submitted' });
    const detail = (await as(world, 'supA').get(`/api/supervisor/live/${world.users.outA.user_id}`)).body;
    expect(detail.tasks[0]).toMatchObject({ task_id: task.task_id, running: false, timers: 1 });
  });
});

describe('durations', () => {
  test('ended sessions and stopped timers are exact to the millisecond on the board, the detail and My sessions', async () => {
    await assign('outA');
    const shift = world.shifts.dept_a.current;
    const record = await createCompleteDraft(world);
    const { rows: [task] } = await pool.query('SELECT task_id FROM task WHERE record_id = $1', [record.record_id]);
    const start = at(shift.start_time, 10);
    const { rows: [s] } = await pool.query(
      'INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at) VALUES ($1, $2, $3, $3) RETURNING session_id',
      [world.users.outA.user_id, shift.shift_id, start],
    );
    // 25 min 30 s + 12 min 15.5 s on one task, in two timers.
    await pool.query(
      `INSERT INTO task_timer (session_id, task_id, user_id, started_at, stopped_at)
       VALUES ($1, $2, $3, $4, $5), ($1, $2, $3, $6, $7)`,
      [s.session_id, task.task_id, world.users.outA.user_id, at(start, 1), at(start, 26.5), at(start, 40), new Date(at(start, 52).getTime() + 15500)],
    );
    await pool.query("UPDATE work_session SET ended_at = $2, end_reason = 'manual' WHERE session_id = $1", [s.session_id, at(start, 95)]);

    expect(workerOn(await boardFor('supA'), 'outA').session.elapsed_ms).toBe(95 * MIN);
    const detail = (await as(world, 'supA').get(`/api/supervisor/live/${world.users.outA.user_id}`)).body;
    expect(detail.sessions[0].elapsed_ms).toBe(95 * MIN);
    expect(detail.tasks[0].total_ms).toBe(25.5 * MIN + 12 * MIN + 15500);
    const mine = (await as(world, 'outA').get('/api/sessions/mine')).body;
    expect(mine.history[0].elapsed_ms).toBe(95 * MIN);
    expect(mine.history[0].tasks[0].total_ms).toBe(25.5 * MIN + 12 * MIN + 15500);
  });
});

describe('the triggers refuse edits, so the board cannot be falsified', () => {
  test('rewriting start, end or timer times, or deleting rows, fails and the reported times do not change', async () => {
    await assign('outA');
    const shift = world.shifts.dept_a.current;
    const record = await createCompleteDraft(world);
    const { rows: [task] } = await pool.query('SELECT task_id FROM task WHERE record_id = $1', [record.record_id]);
    const start = at(shift.start_time, 10);
    const { rows: [s] } = await pool.query(
      'INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at) VALUES ($1, $2, $3, $3) RETURNING session_id',
      [world.users.outA.user_id, shift.shift_id, start],
    );
    const { rows: [t] } = await pool.query(
      'INSERT INTO task_timer (session_id, task_id, user_id, started_at, stopped_at) VALUES ($1, $2, $3, $4, $5) RETURNING timer_id',
      [s.session_id, task.task_id, world.users.outA.user_id, at(start, 5), at(start, 20)],
    );
    await pool.query("UPDATE work_session SET ended_at = $2, end_reason = 'manual' WHERE session_id = $1", [s.session_id, at(start, 60)]);
    const before = (await as(world, 'supA').get(`/api/supervisor/live/${world.users.outA.user_id}`)).body;

    for (const [sql, params] of [
      ['UPDATE work_session SET started_at = $2 WHERE session_id = $1', [s.session_id, at(start, -120)]],
      ['UPDATE work_session SET ended_at = $2 WHERE session_id = $1', [s.session_id, at(start, 300)]],
      ['UPDATE work_session SET user_id = $2 WHERE session_id = $1', [s.session_id, world.users.incA.user_id]],
      ['DELETE FROM work_session WHERE session_id = $1', [s.session_id]],
      ['UPDATE task_timer SET stopped_at = $2 WHERE timer_id = $1', [t.timer_id, at(start, 59)]],
      ['UPDATE task_timer SET started_at = $2 WHERE timer_id = $1', [t.timer_id, at(start, 0)]],
      ['DELETE FROM task_timer WHERE timer_id = $1', [t.timer_id]],
      ['INSERT INTO task_timer (session_id, task_id, user_id, started_at, stopped_at) VALUES ($1, $2, $3, $4, $5)', [s.session_id, task.task_id, world.users.outA.user_id, at(start, 30), at(start, 50)]],
    ]) {
      const code = await pool.query(sql, params).then(() => null, (err) => err.code);
      expect({ sql, code }).toEqual({ sql, code: 'P0001' });
    }
    const after = (await as(world, 'supA').get(`/api/supervisor/live/${world.users.outA.user_id}`)).body;
    expect(after.sessions).toEqual(before.sessions);
    expect(after.tasks).toEqual(before.tasks);
    expect(after.tasks[0].total_ms).toBe(15 * MIN);
  });
});

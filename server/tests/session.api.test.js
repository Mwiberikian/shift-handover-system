// Part M3: the work-session and task-timer API, and the session job driven
// with an injected clock.
const { pool, buildWorld, as, createCompleteDraft } = require('./helpers/fixtures');
const { runSessionCheck } = require('../src/jobs/sessions');

const MIN = 60 * 1000;
const at = (base, mins) => new Date(base.getTime() + mins * MIN);

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const assign = (who, shift = world.shifts.dept_a.current) => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [shift.shift_id, world.users[who].user_id],
);
const sessionRow = async (id) => (await pool.query('SELECT * FROM work_session WHERE session_id = $1', [id])).rows[0];
const timerRows = async (who) => (await pool.query('SELECT * FROM task_timer WHERE user_id = $1 ORDER BY started_at', [world.users[who].user_id])).rows;

// A session inserted directly with chosen times (the API always uses now()).
async function insertSession(who, shift, { startedAt, heartbeatAt = startedAt }) {
  return (await pool.query(
    'INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at) VALUES ($1, $2, $3, $4) RETURNING *',
    [world.users[who].user_id, shift.shift_id, startedAt, heartbeatAt],
  )).rows[0];
}

describe('POST /api/sessions/start', () => {
  test('needs a shift the user is rostered on now: 409 with a clear message', async () => {
    const res = await as(world, 'outA').post('/api/sessions/start');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not on the roster for a shift that is on now/);
    expect(res.body.details.code).toBe('no_current_shift');

    await assign('outA', world.shifts.dept_a.previous); // a shift that has ended does not count
    expect((await as(world, 'outA').post('/api/sessions/start')).status).toBe(409);
  });

  test('starts once; a second start returns the same session; server_now is included', async () => {
    await assign('outA');
    const first = await as(world, 'outA').post('/api/sessions/start');
    expect(first.status).toBe(201);
    expect(first.body.session).toMatchObject({ shift_id: world.shifts.dept_a.current.shift_id, ended_at: null });
    expect(Math.abs(new Date(first.body.server_now) - Date.now())).toBeLessThan(5000);

    const again = await as(world, 'outA').post('/api/sessions/start');
    expect(again.status).toBe(200);
    expect(again.body.session.session_id).toBe(first.body.session.session_id);
    const { rows } = await pool.query("SELECT action FROM audit_log WHERE entity_type = 'work_session'");
    expect(rows.map((r) => r.action)).toEqual(['start']);
  });
});

describe('heartbeat and end', () => {
  test('heartbeat moves last_heartbeat_at; without a session it is a 409', async () => {
    expect((await as(world, 'outA').post('/api/sessions/heartbeat')).body.details.code).toBe('no_active_session');
    await assign('outA');
    const { body: { session } } = await as(world, 'outA').post('/api/sessions/start');
    const hb = await as(world, 'outA').post('/api/sessions/heartbeat');
    expect(hb.status).toBe(200);
    expect(hb.body.server_now).toBeTruthy();
    expect(new Date((await sessionRow(session.session_id)).last_heartbeat_at) >= new Date(session.last_heartbeat_at)).toBe(true);
  });

  test('a heartbeat after 10 silent minutes ends the session at its last heartbeat (409), and it stays ended', async () => {
    await assign('outA');
    const s = await insertSession('outA', world.shifts.dept_a.current, { startedAt: at(new Date(), -30), heartbeatAt: at(new Date(), -11) });
    const res = await as(world, 'outA').post('/api/sessions/heartbeat');
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: 'session_ended', end_reason: 'heartbeat' });
    const row = await sessionRow(s.session_id);
    expect(row.end_reason).toBe('heartbeat');
    expect(row.ended_at).toEqual(s.last_heartbeat_at);
  });

  test('end stops the session (manual) and its running timer', async () => {
    await assign('outA');
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').post('/api/sessions/start');
    await as(world, 'outA').post(`/api/tasks/${(await taskOf(draft)).task_id}/timer/start`);
    const res = await as(world, 'outA').post('/api/sessions/end');
    expect(res.status).toBe(200);
    expect(res.body.ended).toMatchObject({ end_reason: 'manual' });
    expect(res.body.session).toBeNull();
    const [timer] = await timerRows('outA');
    expect(timer.stopped_at).toEqual((await sessionRow(res.body.ended.session_id)).ended_at);
    expect((await as(world, 'outA').post('/api/sessions/end')).status).toBe(409);
  });
});

const taskOf = async (record) => (await pool.query('SELECT * FROM task WHERE record_id = $1 ORDER BY created_at LIMIT 1', [record.record_id])).rows[0];

describe('task timers', () => {
  let draft;
  let t1;
  let t2;
  beforeEach(async () => {
    await assign('outA');
    draft = await createCompleteDraft(world);
    t1 = await taskOf(draft);
    t2 = (await as(world, 'outA').post(`/api/handovers/${draft.record_id}/tasks`, { description: 'Restock the fuel log sheets' })).body;
  });

  test('need an active session', async () => {
    const res = await as(world, 'outA').post(`/api/tasks/${t1.task_id}/timer/start`);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('no_active_session');
  });

  test('starting a timer stops the running one; one running timer per user', async () => {
    await as(world, 'outA').post('/api/sessions/start');
    const a = await as(world, 'outA').post(`/api/tasks/${t1.task_id}/timer/start`);
    expect(a.status).toBe(201);
    expect(a.body.timer).toMatchObject({ task_id: t1.task_id, stopped_at: null });
    expect(a.body.server_now).toBeTruthy();

    const same = await as(world, 'outA').post(`/api/tasks/${t1.task_id}/timer/start`);
    expect(same.status).toBe(200);
    expect(same.body.timer.timer_id).toBe(a.body.timer.timer_id);

    const b = await as(world, 'outA').post(`/api/tasks/${t2.task_id}/timer/start`);
    expect(b.body.stopped_timer_id).toBe(a.body.timer.timer_id);
    const rows = await timerRows('outA');
    expect(rows.map((r) => [r.task_id, r.stopped_at !== null])).toEqual([[t1.task_id, true], [t2.task_id, false]]);

    const stop = await as(world, 'outA').post(`/api/tasks/${t2.task_id}/timer/stop`);
    expect(stop.status).toBe(200);
    expect(stop.body.timer).toBeNull();
    expect(stop.body.stopped.task_id).toBe(t2.task_id);
    expect((await as(world, 'outA').post(`/api/tasks/${t2.task_id}/timer/stop`)).status).toBe(409);
  });

  test("only your own tasks on your current draft", async () => {
    await assign('incA');
    await as(world, 'incA').post('/api/sessions/start');
    expect((await as(world, 'incA').post(`/api/tasks/${t1.task_id}/timer/start`)).status).toBe(403);
    await as(world, 'outA').post('/api/sessions/start');
    expect((await as(world, 'outA').post('/api/tasks/00000000-0000-4000-8000-000000000000/timer/start')).status).toBe(404);
    expect((await as(world, 'outA').post('/api/tasks/not-a-uuid/timer/start')).status).toBe(400);
  });

  test('submitting the handover stops the running timer, and its tasks can no longer be timed', async () => {
    await as(world, 'outA').post('/api/sessions/start');
    await as(world, 'outA').post(`/api/tasks/${t1.task_id}/timer/start`);
    const submit = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
    expect(submit.status).toBe(200);
    const [timer] = await timerRows('outA');
    expect(timer.stopped_at).not.toBeNull();
    expect(timer.stopped_at).toEqual((await pool.query('SELECT submitted_at FROM handover_record WHERE record_id = $1', [draft.record_id])).rows[0].submitted_at);
    expect((await as(world, 'outA').post(`/api/tasks/${t1.task_id}/timer/start`)).status).toBe(409);
  });
});

describe('runSessionCheck (fake clock)', () => {
  // A fixed shift far from now: 2031-03-10 06:00-18:00 EAT.
  const START = new Date('2031-03-10T03:00:00Z');
  const END = new Date('2031-03-10T15:00:00Z');
  let shift;
  let task;
  beforeEach(async () => {
    ({ rows: [shift] } = await pool.query(
      "INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'day', $2, $3) RETURNING *",
      [world.depts.dept_a.department_id, START, END],
    ));
    const { rows: [rec] } = await pool.query(
      'INSERT INTO handover_record (shift_id, department_id, outgoing_user_id) VALUES ($1, $2, $3) RETURNING *',
      [shift.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id],
    );
    ({ rows: [task] } = await pool.query("INSERT INTO task (record_id, description) VALUES ($1, 'Check the GPU on stand 5') RETURNING *", [rec.record_id]));
  });

  test('no heartbeat for 10 minutes: ended at the last heartbeat; its timer stops then too', async () => {
    const s = await insertSession('outA', shift, { startedAt: at(START, 60), heartbeatAt: at(START, 65) });
    await pool.query('INSERT INTO task_timer (session_id, task_id, user_id, started_at) VALUES ($1, $2, $3, $4)', [s.session_id, task.task_id, world.users.outA.user_id, at(START, 61)]);

    expect((await runSessionCheck(at(START, 74.9))).ended).toEqual([]);
    const { ended } = await runSessionCheck(at(START, 75));
    expect(ended).toEqual([expect.objectContaining({ session_id: s.session_id, end_reason: 'heartbeat' })]);
    const row = await sessionRow(s.session_id);
    expect(row.ended_at).toEqual(at(START, 65));
    const [timer] = await timerRows('outA');
    expect(timer.stopped_at).toEqual(at(START, 65));
    expect((await runSessionCheck(at(START, 120))).ended).toEqual([]); // never ended twice
  });

  test('still beating 30 minutes after the shift: ended at shift end + 30 min', async () => {
    const s = await insertSession('outA', shift, { startedAt: at(START, 0), heartbeatAt: at(END, 25) });
    expect((await runSessionCheck(at(END, 29))).ended).toEqual([]);
    const { ended } = await runSessionCheck(at(END, 31));
    expect(ended).toEqual([expect.objectContaining({ session_id: s.session_id, end_reason: 'shift_end' })]);
    expect((await sessionRow(s.session_id)).ended_at).toEqual(at(END, 30));
  });

  test('when both apply, the earlier time wins', async () => {
    const s = await insertSession('outA', shift, { startedAt: at(START, 0), heartbeatAt: at(END, 10) });
    await runSessionCheck(at(END, 60));
    expect(await sessionRow(s.session_id)).toMatchObject({ end_reason: 'heartbeat', ended_at: at(END, 10) });
  });

  test('timers on a submitted record stop at the submission time', async () => {
    const s = await insertSession('outA', shift, { startedAt: at(START, 0), heartbeatAt: at(START, 0) });
    await pool.query('INSERT INTO task_timer (session_id, task_id, user_id, started_at) VALUES ($1, $2, $3, $4)', [s.session_id, task.task_id, world.users.outA.user_id, at(START, 1)]);
    await pool.query("UPDATE handover_record SET status = 'submitted', submitted_at = $2 WHERE record_id = $1", [task.record_id, at(START, 3)]);
    const result = await runSessionCheck(at(START, 4));
    expect(result.timers_stopped_on_submit).toBe(1);
    expect((await timerRows('outA'))[0].stopped_at).toEqual(at(START, 3));
  });

  test('durations: GET /api/sessions/mine sums each task across timers', async () => {
    const s = await insertSession('outA', shift, { startedAt: at(START, 0), heartbeatAt: at(START, 0) });
    const t = (from, to) => pool.query(
      'INSERT INTO task_timer (session_id, task_id, user_id, started_at, stopped_at) VALUES ($1, $2, $3, $4, $5)',
      [s.session_id, task.task_id, world.users.outA.user_id, at(START, from), at(START, to)],
    );
    await t(0, 10);
    await t(20, 25);
    await pool.query("UPDATE work_session SET ended_at = $2, end_reason = 'manual' WHERE session_id = $1", [s.session_id, at(START, 90)]);

    const { body } = await as(world, 'outA').get('/api/sessions/mine');
    expect(body.session).toBeNull();
    const [h] = body.history;
    expect(h).toMatchObject({ session_id: s.session_id, elapsed_ms: 90 * MIN, end_reason: 'manual' });
    expect(h.tasks).toEqual([expect.objectContaining({ task_id: task.task_id, timers: 2, total_ms: 15 * MIN })]);
  });
});

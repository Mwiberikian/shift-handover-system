// Part M4: the supervisor live board API - who is on the shift that is on
// now, each worker's state, session and task timer, task and incident counts,
// last activity, department totals, and one worker's detail.
const {
  pool, buildWorld, as, createCompleteDraft,
} = require('./helpers/fixtures');

const MIN = 60 * 1000;
let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const assign = (who, shift = world.shifts.dept_a.current) => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [shift.shift_id, world.users[who].user_id],
);
const ago = (mins) => new Date(Date.now() - mins * MIN);
const session = (who, { startedAt, heartbeatAt = startedAt, endedAt = null }) => pool.query(
  `INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at, ended_at, end_reason)
   VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
  [world.users[who].user_id, world.shifts.dept_a.current.shift_id, startedAt, heartbeatAt, endedAt, endedAt && 'manual'],
);
const board = async (who = 'supA', qs = '') => (await as(world, who).get(`/api/supervisor/live${qs}`)).body;
const workerOf = (b, who) => b.workers.find((w) => w.user_id === world.users[who].user_id);

// Two extra dept_a workers so every state can be shown at once.
async function addWorker(key, staff, role) {
  const { rows: [u] } = await pool.query(
    `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
     SELECT $1, $2, $3, password_hash, $4, department_id FROM app_user WHERE staff_number = 'T100' RETURNING *`,
    [staff, `Test ${key}`, `${key}@test.example`, role],
  );
  world.users[key] = u;
}

test('rostered workers with their state; totals by state', async () => {
  await addWorker('idleA', 'T110', 'outgoing_staff');
  await addWorker('endedA', 'T111', 'incoming_staff');
  await addWorker('restA', 'T112', 'incoming_staff');
  for (const who of ['outA', 'incA', 'idleA', 'endedA', 'restA']) await assign(who);
  await assign('outB', world.shifts.dept_b.current); // other department: not listed

  await session('incA', { startedAt: ago(30), heartbeatAt: ago(0.5) }); // working
  await session('idleA', { startedAt: ago(30), heartbeatAt: ago(3) }); // idle after 2 min
  await session('endedA', { startedAt: ago(60), heartbeatAt: ago(20), endedAt: ago(20) }); // ended
  // outA: a submitted handover wins over the running session.
  await session('outA', { startedAt: ago(90), heartbeatAt: ago(1) });
  const record = await createCompleteDraft(world);
  await as(world, 'outA').post(`/api/handovers/${record.record_id}/submit`);

  const b = await board();
  expect(b.department.name).toBe('Department dept_a');
  expect(b.shift.shift_id).toBe(world.shifts.dept_a.current.shift_id);
  expect(b.departments).toBeUndefined(); // only admins get the switcher list
  expect(Math.abs(new Date(b.server_now) - Date.now())).toBeLessThan(5000);
  const states = Object.fromEntries(b.workers.map((w) => [w.full_name, w.state]));
  expect(states).toEqual({
    'Test outA': 'handover_submitted', 'Test idleA': 'idle', 'Test incA': 'working', 'Test endedA': 'ended', 'Test restA': 'not_started',
  });
  expect(b.totals).toMatchObject({
    workers: 5, working: 1, idle: 1, ended: 1, not_started: 1, handover_submitted: 1,
  });
});

test('session elapsed, the current task with its timer, task counts, incidents and last activity', async () => {
  await assign('outA');
  const { rows: [s] } = await session('outA', { startedAt: ago(45), heartbeatAt: ago(0.2) });
  const record = await createCompleteDraft(world);
  const out = as(world, 'outA');
  const { body: second } = await out.post(`/api/handovers/${record.record_id}/tasks`, { description: 'Second synthetic task', status: 'in_progress' });
  const { body: third } = await out.post(`/api/handovers/${record.record_id}/tasks`, { description: 'Third synthetic task' });
  await out.patch(`/api/handovers/${record.record_id}/tasks/${third.task_id}`, { status: 'resolved' });
  await out.post(`/api/handovers/${record.record_id}/incidents`, { title: 'Synthetic incident', severity: 'low', occurred_at: new Date().toISOString() });
  await pool.query(
    'INSERT INTO task_timer (session_id, task_id, user_id, started_at) VALUES ($1, $2, $3, $4)',
    [s.session_id, second.task_id, world.users.outA.user_id, ago(12)],
  );

  const w = workerOf(await board(), 'outA');
  expect(w.state).toBe('working');
  expect(w.session.elapsed_ms).toBeGreaterThanOrEqual(45 * MIN - 2000);
  expect(w.session.elapsed_ms).toBeLessThan(46 * MIN);
  expect(w.current_task).toMatchObject({ task_id: second.task_id, description: 'Second synthetic task' });
  expect(w.current_task.elapsed_ms).toBeGreaterThanOrEqual(12 * MIN - 2000);
  expect(w.tasks).toEqual({ open: 1, in_progress: 1, resolved: 1 });
  expect(w.incident_count).toBe(1);
  expect(Date.now() - new Date(w.last_activity_at)).toBeLessThan(10000); // the incident's audit row
  expect(w.handover_status).toBe('draft');
});

test('no shift on now: an empty board, not an error', async () => {
  await pool.query('DELETE FROM shift_assignment');
  await pool.query('UPDATE shift SET start_time = start_time - interval \'2 days\', end_time = end_time - interval \'2 days\'');
  const b = await board();
  expect(b).toMatchObject({ shift: null, workers: [], totals: { workers: 0 } });
});

test('admins choose the department and get the list for the switcher; supervisors are held to their own', async () => {
  await assign('outB', world.shifts.dept_b.current);
  const b = await board('admin', `?department_id=${world.depts.dept_b.department_id}`);
  expect(b.department.code).toBe('dept_b');
  expect(b.departments.map((d) => d.code)).toEqual(['dept_a', 'dept_b']);
  expect(b.workers.map((w) => w.full_name)).toEqual(['Test outB']);
  expect((await board('admin')).department.code).toBe('dept_a'); // default: first by name

  const res = await as(world, 'supA').get(`/api/supervisor/live?department_id=${world.depts.dept_b.department_id}`);
  expect(res.status).toBe(403);
  for (const who of ['outA', 'incA']) expect((await as(world, who).get('/api/supervisor/live')).status).toBe(403);
  expect((await as(world, 'admin').get('/api/supervisor/live?department_id=nope')).status).toBe(400);
});

describe('GET /api/supervisor/live/:userId', () => {
  test('tasks worked on with durations, and a timeline of sessions, timers and actions', async () => {
    await assign('outA');
    const { rows: [s] } = await session('outA', { startedAt: ago(60), heartbeatAt: ago(0.1) });
    const record = await createCompleteDraft(world);
    const { rows: [task] } = await pool.query('SELECT task_id FROM task WHERE record_id = $1', [record.record_id]);
    await pool.query(
      `INSERT INTO task_timer (session_id, task_id, user_id, started_at, stopped_at) VALUES
       ($1, $2, $3, $4, $5), ($1, $2, $3, $6, NULL)`,
      [s.session_id, task.task_id, world.users.outA.user_id, ago(50), ago(40), ago(10)],
    );

    const res = await as(world, 'supA').get(`/api/supervisor/live/${world.users.outA.user_id}`);
    expect(res.status).toBe(200);
    expect(res.body.worker.full_name).toBe('Test outA');
    expect(res.body.shift.shift_id).toBe(world.shifts.dept_a.current.shift_id);
    expect(res.body.tasks).toHaveLength(1);
    const [t] = res.body.tasks;
    expect(t).toMatchObject({ task_id: task.task_id, timers: 2, running: true });
    expect(t.total_ms).toBeGreaterThanOrEqual(20 * MIN - 2000); // 10 min stopped + 10 min running
    expect(t.total_ms).toBeLessThan(21 * MIN);
    const kinds = res.body.timeline.map((e) => e.kind);
    expect(kinds.slice(0, 4)).toEqual(['session_start', 'timer_start', 'timer_stop', 'timer_start']);
    expect(kinds).toContain('action'); // creating the record and its task
    const times = res.body.timeline.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  test('supervisors only for their own department; admins any; workers 403; non-workers 404', async () => {
    expect((await as(world, 'supB').get(`/api/supervisor/live/${world.users.outA.user_id}`)).status).toBe(403);
    expect((await as(world, 'admin').get(`/api/supervisor/live/${world.users.outA.user_id}`)).status).toBe(200);
    expect((await as(world, 'incA').get(`/api/supervisor/live/${world.users.outA.user_id}`)).status).toBe(403);
    expect((await as(world, 'supA').get(`/api/supervisor/live/${world.users.supA.user_id}`)).status).toBe(404);
    expect((await as(world, 'supA').get('/api/supervisor/live/not-a-uuid')).status).toBe(400);
  });
});

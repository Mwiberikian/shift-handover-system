// Phase 1 supervisor controls: starting and ending an employee's work
// session (supervisors in their own department, admins anywhere) and the
// interim duty switch between outgoing_staff and incoming_staff. Covers the
// allowed path, wrong department, wrong role, inactive user, not rostered,
// already active session, audit entries naming both parties, the in-app
// notifications, and the SUPERVISOR_CONTROLS_ENABLED=false kill switch.
const {
  pool, buildWorld, as, createCompleteDraft,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterEach(() => { delete process.env.SUPERVISOR_CONTROLS_ENABLED; });
afterAll(() => pool.end());

const assign = (who, dept = 'dept_a') => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)',
  [world.shifts[dept].current.shift_id, world.users[who].user_id],
);
const idOf = (who) => world.users[who].user_id;
const startFor = (sup, who) => as(world, sup).post(`/api/supervisor/live/${idOf(who)}/session/start`);
const endFor = (sup, who) => as(world, sup).post(`/api/supervisor/live/${idOf(who)}/session/end`);
const switchRole = (sup, who, role) => as(world, sup).post(`/api/supervisor/users/${idOf(who)}/role`, { role });

const auditRows = (entityType, action) => pool.query(
  'SELECT * FROM audit_log WHERE entity_type = $1 AND action = $2 ORDER BY logged_at',
  [entityType, action],
).then((r) => r.rows);
const notificationsFor = (who, type) => pool.query(
  'SELECT * FROM notification WHERE recipient_id = $1 AND type = $2',
  [idOf(who), type],
).then((r) => r.rows);

describe('flag: SUPERVISOR_CONTROLS_ENABLED=false hides every route', () => {
  test('all three routes answer 404 and the board reports controls disabled', async () => {
    await assign('outA');
    process.env.SUPERVISOR_CONTROLS_ENABLED = 'false';
    expect((await startFor('supA', 'outA')).status).toBe(404);
    expect((await endFor('supA', 'outA')).status).toBe(404);
    expect((await switchRole('supA', 'outA', 'incoming_staff')).status).toBe(404);
    expect((await as(world, 'supA').get('/api/supervisor/live')).body.controls_enabled).toBe(false);
  });

  test('default (unset) leaves the routes on and the board reports controls enabled', async () => {
    await assign('outA');
    expect((await startFor('supA', 'outA')).status).toBe(201);
    expect((await as(world, 'supA').get('/api/supervisor/live')).body.controls_enabled).toBe(true);
  });
});

describe('starting a session for an employee', () => {
  test('a supervisor starts a rostered employee of their own department: session, audit naming both, notification', async () => {
    await assign('outA');
    const res = await startFor('supA', 'outA');
    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.session.user_id).toBe(idOf('outA'));

    // The employee sees their own running session.
    const mine = await as(world, 'outA').get('/api/sessions/mine');
    expect(mine.body.session.session_id).toBe(res.body.session.session_id);

    const [audit] = await auditRows('work_session', 'start');
    expect(audit.user_id).toBe(idOf('supA'));
    expect(audit.new_value.for_user_id).toBe(idOf('outA'));
    expect(audit.new_value.by_user_id).toBe(idOf('supA'));

    const [note] = await notificationsFor('outA', 'session_control');
    expect(note.title).toBe('Your supervisor started your session');
    expect(note.body).toContain('Test supA');
  });

  test('admins start sessions in any department', async () => {
    await assign('outB', 'dept_b');
    expect((await startFor('admin', 'outB')).status).toBe(201);
  });

  test('wrong department: 403 and no session', async () => {
    await assign('outA');
    expect((await startFor('supB', 'outA')).status).toBe(403);
    const { rows } = await pool.query('SELECT * FROM work_session WHERE user_id = $1', [idOf('outA')]);
    expect(rows).toHaveLength(0);
  });

  test('wrong caller role: staff get 403', async () => {
    await assign('outA');
    expect((await startFor('incA', 'outA')).status).toBe(403);
    expect((await startFor('outB', 'outA')).status).toBe(403);
  });

  test('targets that are not workers get 404', async () => {
    expect((await startFor('supA', 'supA')).status).toBe(404);
    expect((await startFor('admin', 'supA')).status).toBe(404);
  });

  test('inactive employee: 409', async () => {
    await assign('outA');
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [idOf('outA')]);
    const res = await startFor('supA', 'outA');
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('inactive_user');
  });

  test('not rostered on the current shift: 409 no_current_shift', async () => {
    const res = await startFor('supA', 'outA');
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('no_current_shift');
  });

  test('already active session: 409 and the existing session is untouched', async () => {
    await assign('outA');
    const { body: { session } } = await as(world, 'outA').post('/api/sessions/start');
    const res = await startFor('supA', 'outA');
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('session_already_active');
    const { rows } = await pool.query('SELECT * FROM work_session WHERE user_id = $1', [idOf('outA')]);
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe(session.session_id);
    expect(rows[0].ended_at).toBeNull();
    expect(await notificationsFor('outA', 'session_control')).toHaveLength(0);
  });
});

describe('ending a session for an employee', () => {
  test("the existing 'manual' end reason, running timers stop, audit names both, employee notified", async () => {
    await assign('outA');
    await as(world, 'outA').post('/api/sessions/start');
    const record = await createCompleteDraft(world);
    const { rows: [task] } = await pool.query('SELECT task_id FROM task WHERE record_id = $1 LIMIT 1', [record.record_id]);
    await as(world, 'outA').post(`/api/tasks/${task.task_id}/timer/start`);

    const res = await endFor('supA', 'outA');
    expect(res.status).toBe(200);
    expect(res.body.ended.end_reason).toBe('manual');

    const { rows: timers } = await pool.query('SELECT stopped_at FROM task_timer WHERE user_id = $1', [idOf('outA')]);
    expect(timers).toHaveLength(1);
    expect(timers[0].stopped_at).not.toBeNull();

    const [audit] = await auditRows('work_session', 'end');
    expect(audit.user_id).toBe(idOf('supA'));
    expect(audit.new_value.for_user_id).toBe(idOf('outA'));

    const [note] = await notificationsFor('outA', 'session_control');
    expect(note.title).toBe('Your supervisor ended your session');
  });

  test('no running session: 409', async () => {
    await assign('outA');
    const res = await endFor('supA', 'outA');
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('no_active_session');
  });

  test('wrong department: 403', async () => {
    await assign('outA');
    await as(world, 'outA').post('/api/sessions/start');
    expect((await endFor('supB', 'outA')).status).toBe(403);
  });
});

describe('interim duty switch (outgoing_staff <-> incoming_staff only)', () => {
  test('a supervisor switches an employee of their own department, with audit and a note for the next page load', async () => {
    const res = await switchRole('supA', 'outA', 'incoming_staff');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changed: true, role: 'incoming_staff' });

    const { rows: [u] } = await pool.query('SELECT role FROM app_user WHERE user_id = $1', [idOf('outA')]);
    expect(u.role).toBe('incoming_staff');

    const [audit] = await auditRows('app_user', 'switch_role');
    expect(audit.user_id).toBe(idOf('supA'));
    expect(audit.previous_value.role).toBe('outgoing_staff');
    expect(audit.new_value).toMatchObject({ role: 'incoming_staff', for_user_id: idOf('outA'), by_user_id: idOf('supA') });

    const [note] = await notificationsFor('outA', 'role_changed');
    expect(note.body).toContain('incoming staff');

    // The old token is refused on the next request, so the employee signs in again.
    expect((await as(world, 'outA').get('/api/sessions/mine')).status).toBe(401);
  });

  test('switching to the same role changes nothing and writes no audit entry', async () => {
    const res = await switchRole('supA', 'outA', 'outgoing_staff');
    expect(res.status).toBe(200);
    expect(res.body.changed).toBe(false);
    expect(await auditRows('app_user', 'switch_role')).toHaveLength(0);
    expect(await notificationsFor('outA', 'role_changed')).toHaveLength(0);
  });

  test('never to supervisor or admin: the role value is validated', async () => {
    expect((await switchRole('supA', 'outA', 'supervisor')).status).toBe(400);
    expect((await switchRole('supA', 'outA', 'admin')).status).toBe(400);
  });

  test('never themselves, never a supervisor or admin target', async () => {
    expect((await switchRole('supA', 'supA', 'incoming_staff')).status).toBe(409);
    expect((await switchRole('admin', 'supA', 'incoming_staff')).status).toBe(404);
    expect((await switchRole('admin', 'admin', 'incoming_staff')).status).toBe(409);
  });

  test('wrong department 403, wrong caller role 403, inactive target 409; admins anywhere', async () => {
    expect((await switchRole('supB', 'outA', 'incoming_staff')).status).toBe(403);
    expect((await switchRole('outA', 'incA', 'outgoing_staff')).status).toBe(403);
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [idOf('incA')]);
    expect((await switchRole('supA', 'incA', 'outgoing_staff')).status).toBe(409);
    expect((await switchRole('admin', 'outB', 'incoming_staff')).status).toBe(200);
  });
});

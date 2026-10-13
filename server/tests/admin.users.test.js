// FR-01: the administrator creates, modifies and deactivates accounts, each
// with exactly one role and (for non-admins) one department. FR-17: each of
// these administrative actions is audited.
const request = require('supertest');
const {
  pool, app, buildWorld, as, tokenFor, PASSWORD,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const newUser = (overrides = {}) => ({
  staff_number: 'T300',
  full_name: 'Test New User',
  email: 'New.User@test.example',
  password: PASSWORD,
  role: 'incoming_staff',
  department_id: world.depts.dept_a.department_id,
  ...overrides,
});

const login = (identifier, password = PASSWORD) => request(app).post('/api/auth/login').send({ identifier, password });
const auditFor = async (entityId) => (await pool.query(
  'SELECT user_id, action, previous_value, new_value FROM audit_log WHERE entity_id = $1 ORDER BY log_id', [entityId],
)).rows;

describe('create', () => {
  test('creates an account with one role and one department that can sign in, audited without the hash', async () => {
    const res = await as(world, 'admin').post('/api/admin/users', newUser());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      staff_number: 'T300', email: 'new.user@test.example', role: 'incoming_staff',
      department_id: world.depts.dept_a.department_id, is_active: true,
    });
    expect(res.body.password_hash).toBeUndefined();

    const signIn = await login('T300');
    expect(signIn.status).toBe(200);
    expect(signIn.body.user).toMatchObject({ role: 'incoming_staff', department_id: world.depts.dept_a.department_id });

    const [audit] = await auditFor(res.body.user_id);
    expect(audit).toMatchObject({ user_id: world.users.admin.user_id, action: 'create' });
    expect(audit.new_value.password_hash).toBeUndefined();
    expect(audit.new_value.role).toBe('incoming_staff');
  });

  test('a non-admin role without a department, an unknown department or an unknown role is refused (400)', async () => {
    const admin = as(world, 'admin');
    expect((await admin.post('/api/admin/users', newUser({ department_id: null }))).status).toBe(400);
    expect((await admin.post('/api/admin/users', newUser({ department_id: '00000000-0000-4000-8000-000000000000' }))).status).toBe(400);
    expect((await admin.post('/api/admin/users', newUser({ role: 'pilot' }))).status).toBe(400);
    const { rows } = await pool.query("SELECT 1 FROM app_user WHERE staff_number = 'T300'");
    expect(rows).toHaveLength(0);
  });

  test('a duplicate staff number or email is refused (409)', async () => {
    const admin = as(world, 'admin');
    expect((await admin.post('/api/admin/users', newUser({ staff_number: 'T100' }))).status).toBe(409);
    expect((await admin.post('/api/admin/users', newUser({ email: 'outa@test.example' }))).status).toBe(409);
  });

  test('only admins may create accounts (403)', async () => {
    for (const who of ['outA', 'incA', 'supA']) {
      expect((await as(world, who).post('/api/admin/users', newUser())).status).toBe(403);
    }
  });
});

describe('modify', () => {
  test('changing role and department is audited with old and new values and ends the old session', async () => {
    const oldToken = tokenFor(world.users.incA);
    const res = await as(world, 'admin').patch(`/api/admin/users/${world.users.incA.user_id}`, {
      role: 'outgoing_staff', department_id: world.depts.dept_b.department_id,
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'outgoing_staff', department_id: world.depts.dept_b.department_id });

    const [audit] = await auditFor(world.users.incA.user_id);
    expect(audit.action).toBe('update');
    expect(audit.previous_value).toMatchObject({ role: 'incoming_staff', department_id: world.depts.dept_a.department_id });
    expect(audit.new_value).toMatchObject({ role: 'outgoing_staff', department_id: world.depts.dept_b.department_id });

    const stale = await request(app).get('/api/handovers').set('Authorization', `Bearer ${oldToken}`);
    expect(stale.status).toBe(401);
  });

  test('the staff number cannot be changed', async () => {
    const res = await as(world, 'admin').patch(`/api/admin/users/${world.users.incA.user_id}`, { staff_number: 'X1' });
    expect(res.status).toBe(400);
  });
});

describe('deactivate', () => {
  test('DELETE deactivates (the row is kept), is audited, and the user can no longer sign in', async () => {
    const res = await as(world, 'admin').delete(`/api/admin/users/${world.users.outA.user_id}`);
    expect(res.status).toBe(200);
    expect(res.body.is_active).toBe(false);

    const { rows: [row] } = await pool.query('SELECT is_active FROM app_user WHERE user_id = $1', [world.users.outA.user_id]);
    expect(row.is_active).toBe(false);
    const [audit] = await auditFor(world.users.outA.user_id);
    expect(audit).toMatchObject({ action: 'deactivate', previous_value: { is_active: true }, new_value: { is_active: false } });

    expect((await login('T100')).status).toBe(401);
  });

  test('an admin cannot deactivate or demote their own account (409)', async () => {
    const admin = as(world, 'admin');
    expect((await admin.delete(`/api/admin/users/${world.users.admin.user_id}`)).status).toBe(409);
    expect((await admin.patch(`/api/admin/users/${world.users.admin.user_id}`, { role: 'supervisor' })).status).toBe(409);
  });
});

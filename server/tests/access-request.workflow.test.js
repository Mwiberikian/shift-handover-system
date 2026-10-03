// Request-access workflow (replaces open sign-up): a public request grants no
// access; only an admin approval creates a working account, with the role and
// department the admin chose; admin endpoints stay admin-only.
const request = require('supertest');
const {
  pool, app, buildWorld, as,
} = require('./helpers/fixtures');
const { submitLimitStore } = require('../src/modules/accessRequests/accessRequests.routes');

let world;
beforeEach(async () => {
  world = await buildWorld();
  submitLimitStore.resetAll();
});
afterAll(() => pool.end());

const submitRequest = (overrides = {}) => request(app).post('/api/access-requests').send({
  full_name: 'Amina Wekesa',
  email: 'Amina.Wekesa@test.example',
  staff_number: 'T555',
  requested_department_code: 'dept_a',
  note: 'Joining the ramp team on nights from Monday.',
  ...overrides,
});

const login = (identifier, password) => request(app).post('/api/auth/login').send({ identifier, password });

const auditFor = async (entityId) => (await pool.query(
  'SELECT user_id, action FROM audit_log WHERE entity_id = $1 ORDER BY log_id',
  [entityId],
)).rows;

describe('public submission', () => {
  test('creates a pending request without authentication and without creating an account', async () => {
    const usersBefore = (await pool.query('SELECT count(*)::int AS n FROM app_user')).rows[0].n;
    const res = await submitRequest();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');

    const { rows: [row] } = await pool.query('SELECT * FROM access_request WHERE request_id = $1', [res.body.request_id]);
    expect(row.email).toBe('amina.wekesa@test.example');
    expect(row.user_id).toBeNull();
    expect((await pool.query('SELECT count(*)::int AS n FROM app_user')).rows[0].n).toBe(usersBefore);
    expect(await auditFor(res.body.request_id)).toEqual([{ user_id: null, action: 'create' }]);
  });

  test('a pending request grants no access: login with its email or staff number fails', async () => {
    await submitRequest();
    for (const identifier of ['amina.wekesa@test.example', 'T555']) {
      const res = await login(identifier, 'Password123!');
      expect(res.status).toBe(401);
    }
  });

  test('the requester cannot choose a role or skip review', async () => {
    const res = await submitRequest({ role: 'admin', status: 'approved', department_id: world.depts.dept_a.department_id });
    expect(res.status).toBe(201);
    const { rows: [row] } = await pool.query('SELECT status FROM access_request WHERE request_id = $1', [res.body.request_id]);
    expect(row.status).toBe('pending');
  });

  test('rejects invalid input and unknown departments (400)', async () => {
    expect((await submitRequest({ email: 'not-an-email' })).status).toBe(400);
    expect((await submitRequest({ full_name: '' })).status).toBe(400);
    const unknown = await submitRequest({ requested_department_code: 'nope' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.details[0].field).toBe('requested_department_code');
  });

  test('only one pending request per email (409)', async () => {
    expect((await submitRequest()).status).toBe(201);
    expect((await submitRequest({ email: 'AMINA.WEKESA@test.example' })).status).toBe(409);
  });

  test('is rate-limited per IP: the 6th request within an hour gets 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await submitRequest({ email: `person${i}@test.example` });
      expect(res.status).toBe(201);
    }
    const blocked = await submitRequest({ email: 'person5@test.example' });
    expect(blocked.status).toBe(429);
    expect((await pool.query('SELECT count(*)::int AS n FROM access_request')).rows[0].n).toBe(5);
  });

  test('lists departments publicly with code and name only', async () => {
    const res = await request(app).get('/api/access-requests/departments');
    expect(res.status).toBe(200);
    expect(res.body.map((d) => d.code).sort()).toEqual(['dept_a', 'dept_b']);
    expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'name']);
  });
});

describe('admin approval', () => {
  test('creates a working login with the role and department the admin assigned', async () => {
    const { body: submitted } = await submitRequest({ requested_department_code: 'dept_a' });
    const admin = as(world, 'admin');

    const res = await admin.post(`/api/admin/access-requests/${submitted.request_id}/approve`, {
      role: 'supervisor', department_id: world.depts.dept_b.department_id,
    });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('approved');
    expect(res.body.request.reviewed_by).toBe(world.users.admin.user_id);
    expect(res.body.user.role).toBe('supervisor');
    expect(res.body.user.department_id).toBe(world.depts.dept_b.department_id);
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.temporary_password).toMatch(/^[A-Za-z2-9]{14}$/);

    const loggedIn = await login('amina.wekesa@test.example', res.body.temporary_password);
    expect(loggedIn.status).toBe(200);
    expect(loggedIn.body.user.role).toBe('supervisor');

    const { rows: [row] } = await pool.query('SELECT user_id FROM access_request WHERE request_id = $1', [submitted.request_id]);
    expect(row.user_id).toBe(res.body.user.user_id);
    expect((await auditFor(submitted.request_id)).map((a) => a.action)).toEqual(['create', 'approve']);
    expect((await auditFor(res.body.user.user_id)).map((a) => a.action)).toEqual(['create', 'login']);
  });

  test('requires a staff number when the request did not include one', async () => {
    const { body: submitted } = await submitRequest({ staff_number: '' });
    const admin = as(world, 'admin');
    const url = `/api/admin/access-requests/${submitted.request_id}/approve`;
    const deptB = world.depts.dept_b.department_id;
    expect((await admin.post(url, { role: 'incoming_staff', department_id: deptB })).status).toBe(400);
    const res = await admin.post(url, { role: 'incoming_staff', department_id: deptB, staff_number: 'T556' });
    expect(res.status).toBe(201);
    expect(res.body.user.staff_number).toBe('T556');
  });

  test('a non-admin role without a department is refused and nothing is written', async () => {
    const { body: submitted } = await submitRequest();
    const res = await as(world, 'admin').post(`/api/admin/access-requests/${submitted.request_id}/approve`, { role: 'outgoing_staff' });
    expect(res.status).toBe(400);
    const { rows: [row] } = await pool.query('SELECT status FROM access_request WHERE request_id = $1', [submitted.request_id]);
    expect(row.status).toBe('pending');
    expect((await login('amina.wekesa@test.example', 'anything')).status).toBe(401);
  });

  test('a request can only be decided once (409)', async () => {
    const { body: submitted } = await submitRequest();
    const admin = as(world, 'admin');
    const approveBody = { role: 'incoming_staff', department_id: world.depts.dept_a.department_id };
    expect((await admin.post(`/api/admin/access-requests/${submitted.request_id}/approve`, approveBody)).status).toBe(201);
    expect((await admin.post(`/api/admin/access-requests/${submitted.request_id}/approve`, approveBody)).status).toBe(409);
    expect((await admin.post(`/api/admin/access-requests/${submitted.request_id}/reject`, {})).status).toBe(409);
  });
});

describe('admin rejection', () => {
  test('marks the request rejected with the reason and creates no account', async () => {
    const { body: submitted } = await submitRequest();
    const res = await as(world, 'admin').post(`/api/admin/access-requests/${submitted.request_id}/reject`, { reason: 'Not on the department roster' });
    expect(res.status).toBe(200);
    expect(res.body.request.status).toBe('rejected');
    expect(res.body.request.review_reason).toBe('Not on the department roster');
    expect((await pool.query("SELECT 1 FROM app_user WHERE email = 'amina.wekesa@test.example'")).rows).toHaveLength(0);
    expect((await login('amina.wekesa@test.example', 'Password123!')).status).toBe(401);
    expect((await auditFor(submitted.request_id)).map((a) => a.action)).toEqual(['create', 'reject']);
  });

  test('after rejection the same email may submit a new request', async () => {
    const { body: first } = await submitRequest();
    await as(world, 'admin').post(`/api/admin/access-requests/${first.request_id}/reject`, {});
    expect((await submitRequest()).status).toBe(201);
  });
});

describe('RBAC on admin access-request endpoints', () => {
  test('every non-admin role gets 403 and the request stays pending', async () => {
    const { body: submitted } = await submitRequest();
    const id = submitted.request_id;
    for (const key of ['outA', 'incA', 'supA']) {
      const user = as(world, key);
      const responses = await Promise.all([
        user.get('/api/admin/access-requests'),
        user.post(`/api/admin/access-requests/${id}/approve`, { role: 'admin' }),
        user.post(`/api/admin/access-requests/${id}/reject`, {}),
      ]);
      responses.forEach((r) => expect(r.status).toBe(403));
    }
    const { rows: [row] } = await pool.query('SELECT status FROM access_request WHERE request_id = $1', [id]);
    expect(row.status).toBe('pending');
  });

  test('unauthenticated callers get 401', async () => {
    const { body: submitted } = await submitRequest();
    expect((await request(app).get('/api/admin/access-requests')).status).toBe(401);
    expect((await request(app).post(`/api/admin/access-requests/${submitted.request_id}/approve`).send({ role: 'admin' })).status).toBe(401);
  });

  test('admin lists pending requests by default and can include reviewed ones', async () => {
    const { body: a } = await submitRequest();
    await submitRequest({ email: 'second@test.example', staff_number: 'T557' });
    await as(world, 'admin').post(`/api/admin/access-requests/${a.request_id}/reject`, {});

    const pending = await as(world, 'admin').get('/api/admin/access-requests');
    expect(pending.status).toBe(200);
    expect(pending.body.map((r) => r.email)).toEqual(['second@test.example']);
    expect(pending.body[0].requested_department_name).toBe('Department dept_a');

    const all = await as(world, 'admin').get('/api/admin/access-requests?status=all');
    expect(all.body).toHaveLength(2);
  });
});

const jwt = require('jsonwebtoken');
const request = require('supertest');
const {
  pool, app, buildWorld, PASSWORD,
} = require('./helpers/fixtures');

let world;
beforeAll(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const login = (body) => request(app).post('/api/auth/login').send(body);

test('login by staff_number returns a 30-minute JWT with user_id, role, department_id', async () => {
  const res = await login({ staff_number: 'T100', password: PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.user.password_hash).toBeUndefined();

  const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
  expect(claims).toMatchObject({
    user_id: world.users.outA.user_id,
    role: 'outgoing_staff',
    department_id: world.depts.dept_a.department_id,
  });
  expect(claims.exp - claims.iat).toBe(30 * 60);
});

test('login by email works and is audited', async () => {
  const res = await login({ email: 'OUTA@test.example', password: PASSWORD });
  expect(res.status).toBe(200);
  const audit = await pool.query(
    `SELECT 1 FROM audit_log WHERE action = 'login' AND user_id = $1`, [world.users.outA.user_id],
  );
  expect(audit.rowCount).toBeGreaterThan(0);
});

test('wrong password and unknown user both give the same 401', async () => {
  const wrong = await login({ staff_number: 'T100', password: 'nope' });
  const unknown = await login({ staff_number: 'NOPE', password: PASSWORD });
  expect(wrong.status).toBe(401);
  expect(unknown.status).toBe(401);
  expect(wrong.body).toEqual(unknown.body);
});

test('passwords are stored as bcrypt hashes with work factor 12', async () => {
  const { rows: [u] } = await pool.query('SELECT password_hash FROM app_user WHERE staff_number = $1', ['T100']);
  expect(u.password_hash).toMatch(/^\$2[aby]\$12\$/);
});

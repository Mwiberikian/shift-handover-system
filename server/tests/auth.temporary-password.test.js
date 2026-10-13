// NFR-05: approving an access request never returns the temporary password in
// a normal response; the approving admin sees it once; the new account must
// change it at first sign-in through POST /api/auth/change-password (bcrypt
// cost 12, audited without values) before anything else works.
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const {
  pool, app, buildWorld, as,
} = require('./helpers/fixtures');
const { submitLimitStore } = require('../src/modules/accessRequests/accessRequests.routes');
const { passwordChangeStore } = require('../src/modules/auth/auth.routes');
const oneTimeSecrets = require('../src/utils/oneTimeSecrets');

let world;
beforeEach(async () => {
  world = await buildWorld();
  submitLimitStore.resetAll();
  passwordChangeStore.resetAll();
  oneTimeSecrets.clear();
});
afterAll(() => pool.end());

const NEW_PASSWORD = 'Runway-Lights-42';

async function approveRequest() {
  const { body: req } = await request(app).post('/api/access-requests').send({
    full_name: 'Amina Wekesa', email: 'amina.wekesa@test.example', staff_number: 'T555', requested_department_code: 'dept_a',
  });
  const res = await as(world, 'admin').post(`/api/admin/access-requests/${req.request_id}/approve`, {
    role: 'outgoing_staff', department_id: world.depts.dept_a.department_id,
  });
  return { requestId: req.request_id, res };
}

const reveal = (requestId, token, who = 'admin') => as(world, who)
  .post(`/api/admin/access-requests/${requestId}/temporary-password`, { reveal_token: token });

const login = (identifier, password) => request(app).post('/api/auth/login').send({ identifier, password });
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function signInNewUser() {
  const { requestId, res } = await approveRequest();
  const { body: { temporary_password: temp } } = await reveal(requestId, res.body.temporary_password_reveal.token);
  const { body } = await login('T555', temp);
  return { temp, token: body.token, user: body.user, userId: res.body.user.user_id };
}

describe('approval', () => {
  test('the approve response holds a reveal token, not the password; the account must change it', async () => {
    const { res } = await approveRequest();
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('temporary_password');
    expect(JSON.stringify(res.body)).not.toMatch(/"[A-Za-z2-9]{14}"/);
    expect(res.body.temporary_password_reveal).toEqual({ token: expect.any(String), expires_at: expect.any(String) });
    expect(res.body.user.must_change_password).toBe(true);
  });

  test('the admin who approved sees the password exactly once, with no-store; then 410', async () => {
    const { requestId, res } = await approveRequest();
    const first = await reveal(requestId, res.body.temporary_password_reveal.token);
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    expect(first.body.temporary_password).toMatch(/^[A-Za-z2-9]{14}$/);

    const second = await reveal(requestId, res.body.temporary_password_reveal.token);
    expect(second.status).toBe(410);
    expect(second.body).not.toHaveProperty('temporary_password');
  });

  test('another admin, another request id or a made-up token gets 410, and the real one still works', async () => {
    const { requestId, res } = await approveRequest();
    const { rows: [other] } = await pool.query(
      `INSERT INTO app_user (staff_number, full_name, email, password_hash, role)
       VALUES ('T901', 'Second Admin', 'admin2@test.example', 'x', 'admin') RETURNING *`,
    );
    world.tokens.admin2 = jwt.sign({ user_id: other.user_id, role: 'admin', department_id: null }, process.env.JWT_SECRET);
    const { token } = res.body.temporary_password_reveal;

    expect((await reveal(requestId, token, 'admin2')).status).toBe(410);
    expect((await reveal('00000000-0000-4000-8000-000000000000', token)).status).toBe(410);
    expect((await reveal(requestId, 'made-up')).status).toBe(410);
    expect((await reveal(requestId, token)).status).toBe(200);
  });

  test('the reveal expires', async () => {
    const { requestId, res } = await approveRequest();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask'] });
    try {
      jest.setSystemTime(Date.now() + oneTimeSecrets.DEFAULT_TTL_MS + 1000);
      expect((await reveal(requestId, res.body.temporary_password_reveal.token)).status).toBe(410);
    } finally {
      jest.useRealTimers();
    }
  });

  test('the password is in no database row and no audit entry', async () => {
    const { requestId, res } = await approveRequest();
    const { body: { temporary_password: temp } } = await reveal(requestId, res.body.temporary_password_reveal.token);
    const dump = await pool.query(`
      SELECT row_to_json(a)::text AS t FROM audit_log a
      UNION ALL SELECT row_to_json(u)::text FROM app_user u
      UNION ALL SELECT row_to_json(r)::text FROM access_request r
      UNION ALL SELECT row_to_json(n)::text FROM notification n`);
    for (const { t } of dump.rows) expect(t).not.toContain(temp);
    const { rows: [audit] } = await pool.query(
      "SELECT new_value FROM audit_log WHERE action = 'reveal_temporary_password' AND entity_id = $1", [requestId],
    );
    expect(audit.new_value).toEqual({ shown_to: world.users.admin.user_id });
  });
});

describe('first sign-in', () => {
  test('sign-in works, flags the session, and every other route is refused until the password changes', async () => {
    const { token, user } = await signInNewUser();
    expect(user.must_change_password).toBe(true);
    expect(jwt.decode(token).pwd_change).toBe(true);

    const me = await request(app).get('/api/auth/me').set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.must_change_password).toBe(true);

    for (const path of ['/api/handovers', '/api/notifications', '/api/messages/inbox', '/api/handovers/meta']) {
      const res = await request(app).get(path).set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.details).toEqual({ code: 'password_change_required' });
    }
  });

  test('change-password: bcrypt cost 12, flag cleared, fresh session works, old password refused, audited without values', async () => {
    const { temp, token, userId } = await signInNewUser();
    const res = await request(app).post('/api/auth/change-password').set(bearer(token))
      .send({ current_password: temp, new_password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.user.must_change_password).toBe(false);
    expect(jwt.decode(res.body.token)).not.toHaveProperty('pwd_change');

    const { rows: [row] } = await pool.query('SELECT password_hash, must_change_password FROM app_user WHERE user_id = $1', [userId]);
    expect(row.must_change_password).toBe(false);
    expect(bcrypt.getRounds(row.password_hash)).toBe(12);
    expect(await bcrypt.compare(NEW_PASSWORD, row.password_hash)).toBe(true);

    expect((await request(app).get('/api/handovers').set(bearer(res.body.token))).status).toBe(200);
    expect((await request(app).get('/api/handovers').set(bearer(token))).status).toBe(200); // old token, same claims
    expect((await login('T555', temp)).status).toBe(401);
    expect((await login('T555', NEW_PASSWORD)).status).toBe(200);

    const { rows: audit } = await pool.query(
      "SELECT previous_value, new_value FROM audit_log WHERE action = 'change_password' AND entity_id = $1", [userId],
    );
    expect(audit).toEqual([{ previous_value: { must_change_password: true }, new_value: { must_change_password: false, password_changed: true } }]);
    const text = JSON.stringify(audit);
    expect(text).not.toContain(NEW_PASSWORD);
    expect(text).not.toContain(temp);
    expect(text).not.toContain(row.password_hash);
  });

  test('a wrong current password, a reused or short new password are refused and change nothing', async () => {
    const { temp, token, userId } = await signInNewUser();
    const post = (body) => request(app).post('/api/auth/change-password').set(bearer(token)).send(body);
    const fields = (r) => r.body.details.map((d) => d.field);

    expect(fields(await post({ current_password: 'wrong', new_password: NEW_PASSWORD }))).toEqual(['current_password']);
    expect(fields(await post({ current_password: temp, new_password: temp }))).toEqual(['new_password']);
    expect(fields(await post({ current_password: temp, new_password: 'short' }))).toEqual(['new_password']);
    expect(fields(await post({ current_password: temp, new_password: 'é'.repeat(40) }))).toEqual(['new_password']); // 80 bytes
    const { rows: [row] } = await pool.query('SELECT must_change_password FROM app_user WHERE user_id = $1', [userId]);
    expect(row.must_change_password).toBe(true);
  });

  test('change-password needs a session and is rate-limited per user', async () => {
    expect((await request(app).post('/api/auth/change-password').send({ current_password: 'a', new_password: NEW_PASSWORD })).status).toBe(401);
    const { token } = await signInNewUser();
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(app).post('/api/auth/change-password').set(bearer(token)).send({ current_password: 'wrong', new_password: NEW_PASSWORD });
    }
    expect(last.status).toBe(429);
  });

  test('existing accounts are not affected', async () => {
    const res = await as(world, 'outA').get('/api/handovers');
    expect(res.status).toBe(200);
    const signIn = await login('T100', 'Password123!');
    expect(signIn.body.user.must_change_password).toBe(false);
    expect(jwt.decode(signIn.body.token)).not.toHaveProperty('pwd_change');
  });
});

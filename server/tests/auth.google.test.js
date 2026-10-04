// Sign in with Google. verifyIdToken is mocked (no network): tokens are looked
// up in TOKENS, and like the real library the mock rejects unknown tokens and
// tokens whose audience doesn't match. Google may only sign in to existing,
// active accounts; it never creates one (FR-01).
const jwt = require('jsonwebtoken');
const request = require('supertest');

const mockVerify = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerify })),
}));

const { pool, app, buildWorld } = require('./helpers/fixtures');

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const TOKENS = {};
const token = (name, payload) => {
  TOKENS[name] = {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, email_verified: true, ...payload,
  };
  return name;
};

let world;
beforeEach(async () => {
  world = await buildWorld();
  process.env.GOOGLE_CLIENT_ID = CLIENT_ID;
  mockVerify.mockReset();
  mockVerify.mockImplementation(async ({ idToken, audience }) => {
    const p = TOKENS[idToken];
    if (!p) throw new Error('Wrong number of segments in token');
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (!aud.includes(audience)) throw new Error('Wrong recipient, payload audience != requiredAudience');
    return { getPayload: () => p };
  });
});
afterAll(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  return pool.end();
});

const google = (credential) => request(app).post('/api/auth/google').send({ credential });
const userRow = async (id) => (await pool.query('SELECT google_sub, is_active FROM app_user WHERE user_id = $1', [id])).rows[0];

describe('POST /api/auth/google', () => {
  test('a known active user gets the normal 30-minute JWT, the Google sub is linked, and both are audited', async () => {
    const res = await google(token('outA', { sub: 'g-outA', email: 'OUTA@test.example', name: 'Test outA' }));
    expect(res.status).toBe(200);
    const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(claims).toMatchObject({ user_id: world.users.outA.user_id, role: 'outgoing_staff', department_id: world.depts.dept_a.department_id });
    expect(claims.exp - claims.iat).toBe(30 * 60);
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.user).not.toHaveProperty('google_sub');

    expect((await userRow(world.users.outA.user_id)).google_sub).toBe('g-outA');
    const { rows } = await pool.query(
      "SELECT action, new_value FROM audit_log WHERE entity_id = $1 AND action IN ('link_google', 'login') ORDER BY log_id",
      [world.users.outA.user_id],
    );
    expect(rows.map((r) => r.action)).toEqual(['link_google', 'login']);
    expect(rows[1].new_value).toEqual({ method: 'google' });
  });

  test('once linked, the user signs in by sub even if their Google email changes', async () => {
    await google(token('first', { sub: 'g-incA', email: 'inca@test.example' }));
    const res = await google(token('renamed', { sub: 'g-incA', email: 'new-address@gmail.example' }));
    expect(res.status).toBe(200);
    expect(jwt.decode(res.body.token).user_id).toBe(world.users.incA.user_id);
  });

  test('an unknown email gets 404 no_account with the verified name and email, and no token', async () => {
    const usersBefore = (await pool.query('SELECT count(*)::int AS n FROM app_user')).rows[0].n;
    const res = await google(token('stranger', { sub: 'g-new', email: 'New.Person@gmail.example', name: 'New Person' }));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: expect.any(String), code: 'no_account', name: 'New Person', email: 'new.person@gmail.example',
    });
    expect(res.body.token).toBeUndefined();
    expect((await pool.query('SELECT count(*)::int AS n FROM app_user')).rows[0].n).toBe(usersBefore);
  });

  test('an unverified Google email is refused, even for a known address', async () => {
    const res = await google(token('unverified', { sub: 'g-x', email: 'outa@test.example', email_verified: false }));
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
    expect((await userRow(world.users.outA.user_id)).google_sub).toBeNull();
  });

  test('a deactivated user is refused and the account is not linked', async () => {
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.supA.user_id]);
    const res = await google(token('inactive', { sub: 'g-supA', email: 'supa@test.example' }));
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
    expect((await userRow(world.users.supA.user_id)).google_sub).toBeNull();
  });

  test('a deactivated user who was already linked is refused', async () => {
    expect((await google(token('linkFirst', { sub: 'g-supB', email: 'supb@test.example' }))).status).toBe(200);
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.supB.user_id]);
    const res = await google(token('again', { sub: 'g-supB', email: 'supb@test.example' }));
    expect(res.status).toBe(403);
    expect(res.body.token).toBeUndefined();
  });

  test('a token issued for a different audience is refused', async () => {
    const res = await google(token('otherApp', { sub: 'g-outA', email: 'outa@test.example', aud: 'someone-else.apps.googleusercontent.com' }));
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  test('our own audience check holds even if the library returned a foreign-audience payload', async () => {
    mockVerify.mockImplementationOnce(async () => ({ getPayload: () => ({ sub: 'g-outA', email: 'outa@test.example', email_verified: true, aud: 'evil' }) }));
    const res = await google('anything');
    expect(res.status).toBe(401);
  });

  test('a malformed or forged credential is refused (401)', async () => {
    expect((await google('not-a-real-token')).status).toBe(401);
    expect((await request(app).post('/api/auth/google').send({})).status).toBe(400);
  });

  test('a second Google account with the same email but a different sub is refused once linked', async () => {
    expect((await google(token('original', { sub: 'g-admin-1', email: 'admin@test.example' }))).status).toBe(200);
    const res = await google(token('impostor', { sub: 'g-admin-2', email: 'admin@test.example' }));
    expect(res.status).toBe(409);
    expect(res.body.token).toBeUndefined();
    expect((await userRow(world.users.admin.user_id)).google_sub).toBe('g-admin-1');
  });
});

describe('when GOOGLE_CLIENT_ID is unset', () => {
  test('every Google endpoint returns 503 and password login is unaffected', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    expect((await request(app).get('/api/auth/google/config')).status).toBe(503);
    expect((await google(token('any', { sub: 's', email: 'outa@test.example' }))).status).toBe(503);
    expect((await request(app).post('/api/auth/google/profile').send({ credential: 'any' })).status).toBe(503);
    expect(mockVerify).not.toHaveBeenCalled();
    const pw = await request(app).post('/api/auth/login').send({ identifier: 'T100', password: 'Password123!' });
    expect(pw.status).toBe(200);
  });
});

describe('config and profile', () => {
  test('config exposes only the public client id', async () => {
    const res = await request(app).get('/api/auth/google/config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ client_id: CLIENT_ID });
  });

  test('profile returns the verified name and email without signing in or linking', async () => {
    const res = await request(app).post('/api/auth/google/profile').send({ credential: token('prof', { sub: 'g-outA', email: 'outa@test.example', name: 'Achieng' }) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Achieng', email: 'outa@test.example' });
    expect((await userRow(world.users.outA.user_id)).google_sub).toBeNull();
  });

  test('profile refuses an unverified email', async () => {
    const res = await request(app).post('/api/auth/google/profile').send({ credential: token('unv', { sub: 'z', email: 'z@gmail.example', email_verified: false }) });
    expect(res.status).toBe(403);
  });
});

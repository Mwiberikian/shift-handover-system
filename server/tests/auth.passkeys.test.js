// Passkey sign-in. The library's verify functions are mocked, with no real
// authenticator: like the real ones, they compare what the "browser" reports
// (response.client) against what the server expected, and their error messages
// quote the challenge. Generating options uses the real library.
const jwt = require('jsonwebtoken');
const request = require('supertest');

const mockVerifyRegistration = jest.fn();
const mockVerifyAuthentication = jest.fn();
jest.mock('@simplewebauthn/server', () => ({
  ...jest.requireActual('@simplewebauthn/server'),
  verifyRegistrationResponse: (...args) => mockVerifyRegistration(...args),
  verifyAuthenticationResponse: (...args) => mockVerifyAuthentication(...args),
}));

const {
  pool, app, buildWorld, as, PASSWORD,
} = require('./helpers/fixtures');
const { webauthnConfig } = require('../src/config/env');
const passkeyRoutes = require('../src/modules/auth/passkeys.routes');

const RP_ID = 'shms.example';
const ORIGIN = 'https://shms.example';
const GENERIC = 'Passkey sign-in failed. Use your password or try again.';
const PUBLIC_KEY = Buffer.from('fake-public-key-bytes');
const BASE = '/api/auth/passkeys';

function checkClientData({
  response, expectedChallenge, expectedOrigin, expectedRPID,
}) {
  const c = response.client;
  if (c.challenge !== expectedChallenge) throw new Error(`Unexpected response challenge "${c.challenge}", expected "${expectedChallenge}"`);
  if (c.origin !== expectedOrigin) throw new Error(`Unexpected response origin "${c.origin}", expected "${expectedOrigin}"`);
  if (c.rpID !== expectedRPID) throw new Error('Unexpected RP ID hash');
}

let world;
beforeEach(async () => {
  world = await buildWorld();
  passkeyRoutes.loginLimitStore.resetAll();
  passkeyRoutes.manageLimitStore.resetAll();
  process.env.WEBAUTHN_RP_ID = RP_ID;
  process.env.WEBAUTHN_ORIGIN = ORIGIN;
  process.env.WEBAUTHN_RP_NAME = 'Shift Handover Management System';

  mockVerifyRegistration.mockReset();
  mockVerifyRegistration.mockImplementation(async (opts) => {
    checkClientData(opts);
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: opts.response.id, publicKey: new Uint8Array(PUBLIC_KEY), counter: 0, transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    };
  });
  mockVerifyAuthentication.mockReset();
  mockVerifyAuthentication.mockImplementation(async (opts) => {
    checkClientData(opts);
    if (opts.response.client.badSignature) return { verified: false, authenticationInfo: {} };
    return { verified: true, authenticationInfo: { newCounter: opts.response.client.counter ?? 0, credentialBackedUp: true } };
  });
});
afterAll(() => {
  delete process.env.WEBAUTHN_RP_ID;
  delete process.env.WEBAUTHN_ORIGIN;
  delete process.env.WEBAUTHN_RP_NAME;
  return pool.end();
});

const assertion = (id, client, challenge) => ({ id, client: { challenge, origin: ORIGIN, rpID: RP_ID, ...client } });

async function addPasskey(userKey, id = `cred-${userKey}`, label = 'My phone') {
  const opts = await as(world, userKey).post(`${BASE}/register/options`);
  expect(opts.status).toBe(200);
  const res = await as(world, userKey).post(`${BASE}/register/verify`, {
    challenge_id: opts.body.challenge_id, response: assertion(id, {}, opts.body.options.challenge), label,
  });
  expect(res.status).toBe(201);
  return res.body;
}

const loginOptions = () => request(app).post(`${BASE}/login/options`);
const loginVerify = (body) => request(app).post(`${BASE}/login/verify`).send(body);

async function signIn(credentialId, client = {}) {
  const { body } = await loginOptions();
  return loginVerify({ challenge_id: body.challenge_id, response: assertion(credentialId, client, body.options.challenge) });
}

const expectGeneric = (res) => {
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: GENERIC });
};

const auditRows = async (action) => (await pool.query('SELECT * FROM audit_log WHERE action = $1 ORDER BY log_id', [action])).rows;
const passkeyRow = async (id) => (await pool.query('SELECT * FROM passkey_credential WHERE credential_id = $1', [id])).rows[0];

describe('registration', () => {
  test('needs a session', async () => {
    expect((await request(app).post(`${BASE}/register/options`)).status).toBe(401);
    expect((await request(app).post(`${BASE}/register/verify`).send({})).status).toBe(401);
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  test('asks for a discoverable, user-verified credential with no attestation, excludes existing passkeys, stores it and audits', async () => {
    const added = await addPasskey('outA', 'cred-1', '  Work laptop  ');
    expect(added).toEqual({
      id: expect.any(String), label: 'Work laptop', created_at: expect.any(String), last_used_at: null, device_type: 'multiDevice',
    });

    const row = await passkeyRow('cred-1');
    expect(row.user_id).toBe(world.users.outA.user_id);
    expect(Buffer.compare(row.public_key, PUBLIC_KEY)).toBe(0);
    expect(row.transports).toEqual(['internal']);
    expect(row.backed_up).toBe(true);

    const { body: { options } } = await as(world, 'outA').post(`${BASE}/register/options`);
    expect(options.rp).toEqual({ name: 'Shift Handover Management System', id: RP_ID });
    expect(options.attestation).toBe('none');
    expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', requireResidentKey: true, userVerification: 'required' });
    expect(options.excludeCredentials.map((c) => c.id)).toEqual(['cred-1']);

    const [audit] = await auditRows('passkey_added');
    expect(audit.user_id).toBe(world.users.outA.user_id);
    expect(audit.new_value).toEqual({ passkey_id: added.id, label: 'Work laptop' });
  });

  test("another user's or a sign-in challenge cannot register a passkey", async () => {
    const theirs = (await as(world, 'incA').post(`${BASE}/register/options`)).body;
    const login = (await loginOptions()).body;
    for (const c of [theirs, login]) {
      const res = await as(world, 'outA').post(`${BASE}/register/verify`, {
        challenge_id: c.challenge_id, response: assertion('cred-x', {}, c.options.challenge),
      });
      expect(res.status).toBe(400);
    }
    expect(mockVerifyRegistration).not.toHaveBeenCalled();
  });

  test('a registration challenge is single-use and expires', async () => {
    const { body: opts } = await as(world, 'outA').post(`${BASE}/register/options`);
    const verify = () => as(world, 'outA').post(`${BASE}/register/verify`, {
      challenge_id: opts.challenge_id, response: assertion('cred-1', {}, opts.options.challenge),
    });
    expect((await verify()).status).toBe(201);
    expect((await verify()).status).toBe(400);

    const { body: late } = await as(world, 'incA').post(`${BASE}/register/options`);
    await pool.query("UPDATE webauthn_challenge SET expires_at = now() - interval '1 second' WHERE id = $1", [late.challenge_id]);
    const res = await as(world, 'incA').post(`${BASE}/register/verify`, {
      challenge_id: late.challenge_id, response: assertion('cred-2', {}, late.options.challenge),
    });
    expect(res.status).toBe(400);
    expect(await passkeyRow('cred-2')).toBeUndefined();
  });

  test.each([
    ['origin', { origin: 'https://evil.example' }],
    ['RP ID', { rpID: 'evil.example' }],
  ])('a wrong %s is rejected and nothing is stored', async (_, client) => {
    const { body: opts } = await as(world, 'outA').post(`${BASE}/register/options`);
    const res = await as(world, 'outA').post(`${BASE}/register/verify`, {
      challenge_id: opts.challenge_id, response: assertion('cred-1', client, opts.options.challenge),
    });
    expect(res.status).toBe(400);
    expect(await passkeyRow('cred-1')).toBeUndefined();
  });

  test('a credential already registered is refused without leaking it', async () => {
    await addPasskey('outA', 'cred-1');
    const { body: opts } = await as(world, 'incA').post(`${BASE}/register/options`);
    const res = await as(world, 'incA').post(`${BASE}/register/verify`, {
      challenge_id: opts.challenge_id, response: assertion('cred-1', {}, opts.options.challenge),
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('cred-1');
  });

  test('each user is limited to 10 passkeys, at options and at verify', async () => {
    const userId = world.users.outA.user_id;
    const insert = (n) => pool.query(
      "INSERT INTO passkey_credential (credential_id, user_id, public_key, device_type, label) VALUES ($1, $2, '\\x00', 'singleDevice', 'x')",
      [`seeded-${n}`, userId],
    );
    for (let n = 0; n < 9; n += 1) await insert(n);
    const { body: opts } = await as(world, 'outA').post(`${BASE}/register/options`);
    await insert(9);

    expect((await as(world, 'outA').post(`${BASE}/register/options`)).status).toBe(409);
    const late = await as(world, 'outA').post(`${BASE}/register/verify`, {
      challenge_id: opts.challenge_id, response: assertion('cred-11', {}, opts.options.challenge),
    });
    expect(late.status).toBe(409);
    expect(await passkeyRow('cred-11')).toBeUndefined();
  });

  test('a must_change_password account cannot add or manage passkeys until it has changed it', async () => {
    await pool.query('UPDATE app_user SET must_change_password = true WHERE user_id = $1', [world.users.outA.user_id]);
    const res = await as(world, 'outA').post(`${BASE}/register/options`);
    expect(res.status).toBe(403);
    expect(res.body.details).toEqual({ code: 'password_change_required' });
    expect((await as(world, 'outA').get(BASE)).status).toBe(403);
  });
});

describe('sign-in', () => {
  test('options need no username and require user verification', async () => {
    const { status, body } = await loginOptions();
    expect(status).toBe(200);
    expect(body.options.rpId).toBe(RP_ID);
    expect(body.options.userVerification).toBe('required');
    expect(body.options.allowCredentials ?? []).toEqual([]);
  });

  test('gives the same session as a password login, updates the passkey and audits', async () => {
    await addPasskey('outA', 'cred-1');
    const res = await signIn('cred-1', { counter: 5 });
    expect(res.status).toBe(200);

    const pw = await request(app).post('/api/auth/login').send({ identifier: 'T100', password: PASSWORD });
    const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
    const pwClaims = jwt.verify(pw.body.token, process.env.JWT_SECRET);
    expect(Object.keys(claims).sort()).toEqual(Object.keys(pwClaims).sort());
    expect(claims.exp - claims.iat).toBe(pwClaims.exp - pwClaims.iat);
    expect(claims).toMatchObject({ user_id: pwClaims.user_id, role: pwClaims.role, department_id: pwClaims.department_id });
    expect(res.body.user).toEqual(pw.body.user);
    expect(res.body.user).not.toHaveProperty('password_hash');

    const row = await passkeyRow('cred-1');
    expect(row.counter).toBe('5');
    expect(row.last_used_at).not.toBeNull();

    const [audit] = await auditRows('passkey_login_success');
    expect(audit.user_id).toBe(world.users.outA.user_id);
    const logins = await auditRows('login');
    expect(logins[0].new_value).toEqual({ method: 'passkey' });

    const call = mockVerifyAuthentication.mock.calls[0][0];
    expect(call).toMatchObject({ expectedOrigin: ORIGIN, expectedRPID: RP_ID, requireUserVerification: true });
    expect(call.credential.id).toBe('cred-1');
    expect(Buffer.compare(Buffer.from(call.credential.publicKey), PUBLIC_KEY)).toBe(0);
  });

  test('must_change_password behaves as for a password login', async () => {
    await addPasskey('outA', 'cred-1');
    await pool.query('UPDATE app_user SET must_change_password = true WHERE user_id = $1', [world.users.outA.user_id]);

    const res = await signIn('cred-1');
    const pw = await request(app).post('/api/auth/login').send({ identifier: 'T100', password: PASSWORD });
    expect(jwt.decode(res.body.token).pwd_change).toBe(true);
    expect(jwt.decode(pw.body.token).pwd_change).toBe(true);
    expect(res.body.user.must_change_password).toBe(true);

    const bearer = (r) => r.set('Authorization', `Bearer ${res.body.token}`);
    expect((await bearer(request(app).get('/api/auth/me'))).status).toBe(200);
    const refused = await bearer(request(app).get('/api/notifications'));
    expect(refused.status).toBe(403);
    expect(refused.body.details).toEqual({ code: 'password_change_required' });
  });

  test('a sign-in challenge is single-use', async () => {
    await addPasskey('outA', 'cred-1');
    const { body } = await loginOptions();
    const attempt = { challenge_id: body.challenge_id, response: assertion('cred-1', {}, body.options.challenge) };
    expect((await loginVerify(attempt)).status).toBe(200);
    expectGeneric(await loginVerify(attempt));
    expect(mockVerifyAuthentication).toHaveBeenCalledTimes(1);
  });

  test('a failed attempt uses the challenge up', async () => {
    await addPasskey('outA', 'cred-1');
    const { body } = await loginOptions();
    expectGeneric(await loginVerify({ challenge_id: body.challenge_id, response: assertion('cred-1', { origin: 'https://evil.example' }, body.options.challenge) }));
    expectGeneric(await loginVerify({ challenge_id: body.challenge_id, response: assertion('cred-1', {}, body.options.challenge) }));
  });

  test('an expired challenge is refused, and expired rows are purged when options are next issued', async () => {
    await addPasskey('outA', 'cred-1');
    const { body } = await loginOptions();
    await pool.query("UPDATE webauthn_challenge SET expires_at = now() - interval '1 second' WHERE id = $1", [body.challenge_id]);
    expectGeneric(await loginVerify({ challenge_id: body.challenge_id, response: assertion('cred-1', {}, body.options.challenge) }));

    await loginOptions();
    const { rowCount } = await pool.query('SELECT 1 FROM webauthn_challenge WHERE id = $1', [body.challenge_id]);
    expect(rowCount).toBe(0);
  });

  test('challenges live 5 minutes', async () => {
    const { body } = await loginOptions();
    const { rows: [row] } = await pool.query('SELECT extract(epoch FROM expires_at - now()) AS s FROM webauthn_challenge WHERE id = $1', [body.challenge_id]);
    expect(Number(row.s)).toBeGreaterThan(295);
    expect(Number(row.s)).toBeLessThanOrEqual(300);
  });

  test('a registration challenge cannot be used to sign in', async () => {
    await addPasskey('outA', 'cred-1');
    const { body } = await as(world, 'outA').post(`${BASE}/register/options`);
    expectGeneric(await loginVerify({ challenge_id: body.challenge_id, response: assertion('cred-1', {}, body.options.challenge) }));
  });

  test.each([
    ['wrong origin', { origin: 'https://evil.example' }, 'origin_mismatch'],
    ['wrong RP ID', { rpID: 'evil.example' }, 'rpid_mismatch'],
    ['wrong challenge', { challenge: 'not-the-challenge' }, 'challenge_mismatch'],
    ['bad signature', { badSignature: true }, 'signature_invalid'],
  ])('%s is rejected with the generic error', async (_, client, reason) => {
    await addPasskey('outA', 'cred-1');
    const res = await signIn('cred-1', client);
    expectGeneric(res);
    expect(res.body.token).toBeUndefined();
    const [audit] = await auditRows('passkey_login_failed');
    expect(audit.user_id).toBe(world.users.outA.user_id);
    expect(audit.new_value).toEqual({ reason });
  });

  test('a replayed or backwards counter is rejected and the stored counter stays', async () => {
    await addPasskey('outA', 'cred-1');
    expect((await signIn('cred-1', { counter: 7 })).status).toBe(200);

    expectGeneric(await signIn('cred-1', { counter: 7 }));
    expectGeneric(await signIn('cred-1', { counter: 3 }));
    expectGeneric(await signIn('cred-1', { counter: 0 }));

    expect((await passkeyRow('cred-1')).counter).toBe('7');
    const rows = await auditRows('passkey_login_failed');
    expect(rows.map((r) => r.new_value.reason)).toEqual(['counter_replay', 'counter_replay', 'counter_replay']);
    expect(await auditRows('passkey_login_success')).toHaveLength(1);
  });

  test("the library's own counter refusal also gives the generic error", async () => {
    await addPasskey('outA', 'cred-1');
    mockVerifyAuthentication.mockRejectedValueOnce(new Error('Response counter value 1 was lower than expected 2'));
    expectGeneric(await signIn('cred-1'));
    expect((await auditRows('passkey_login_failed'))[0].new_value).toEqual({ reason: 'counter_replay' });
  });

  test('an authenticator with no counter (always 0) can keep signing in', async () => {
    await addPasskey('outA', 'cred-1');
    expect((await signIn('cred-1', { counter: 0 })).status).toBe(200);
    expect((await signIn('cred-1', { counter: 0 })).status).toBe(200);
  });

  test('an inactive user is refused with the generic error', async () => {
    await addPasskey('outA', 'cred-1');
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.outA.user_id]);
    const res = await signIn('cred-1');
    expectGeneric(res);
    expect((await passkeyRow('cred-1')).last_used_at).toBeNull();
    expect((await auditRows('passkey_login_failed'))[0].new_value).toEqual({ reason: 'user_inactive' });
  });

  test('an unknown credential gets the same response and is audited with no user', async () => {
    await addPasskey('outA', 'cred-1');
    const known = await signIn('cred-1', { origin: 'https://evil.example' });
    const unknown = await signIn('no-such-credential');
    expectGeneric(unknown);
    expect(unknown.body).toEqual(known.body);
    expect(unknown.status).toBe(known.status);

    const rows = await auditRows('passkey_login_failed');
    expect(rows[1].user_id).toBeNull();
    expect(rows[1].new_value).toEqual({ reason: 'unknown_credential' });
  });

  test.each([
    ['an empty body', {}],
    ['a malformed challenge id', { challenge_id: 'nope', response: { id: 'x' } }],
    ['an unknown challenge id', { challenge_id: '00000000-0000-4000-8000-000000000000', response: { id: 'x' } }],
  ])('%s gets the generic error', async (_, body) => {
    expectGeneric(await loginVerify(body));
  });

  test('a response with no credential id gets the generic error', async () => {
    const { body } = await loginOptions();
    expectGeneric(await loginVerify({ challenge_id: body.challenge_id }));
  });

  test('an unexpected database error also gets the generic error', async () => {
    await addPasskey('outA', 'cred-1');
    const { body } = await loginOptions();
    const spy = jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('connection lost'));
    const res = await loginVerify({ challenge_id: body.challenge_id, response: assertion('cred-1', {}, body.options.challenge) });
    spy.mockRestore();
    expectGeneric(res);
  });
});

describe('managing your own passkeys', () => {
  test('lists only your own, with only the public fields', async () => {
    const mine = await addPasskey('outA', 'cred-a');
    await addPasskey('incA', 'cred-b');
    const res = await as(world, 'outA').get(BASE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([mine]);
    expect(Object.keys(res.body[0]).sort()).toEqual(['created_at', 'device_type', 'id', 'label', 'last_used_at']);
  });

  test('renames your own', async () => {
    const mine = await addPasskey('outA');
    const res = await as(world, 'outA').patch(`${BASE}/${mine.id}`, { label: ' Desk key ' });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Desk key');
  });

  test.each([[''], ['   '], ['x'.repeat(61)], [5]])('refuses the label %j', async (label) => {
    const mine = await addPasskey('outA');
    expect((await as(world, 'outA').patch(`${BASE}/${mine.id}`, { label })).status).toBe(400);
  });

  test('removes your own and audits it; the credential can no longer sign in', async () => {
    const mine = await addPasskey('outA', 'cred-1');
    expect((await as(world, 'outA').delete(`${BASE}/${mine.id}`)).status).toBe(204);
    expect(await passkeyRow('cred-1')).toBeUndefined();
    const [audit] = await auditRows('passkey_removed');
    expect(audit.user_id).toBe(world.users.outA.user_id);
    expect(audit.previous_value).toEqual({ passkey_id: mine.id, label: 'My phone' });
    expectGeneric(await signIn('cred-1'));
  });

  test("cannot rename or remove someone else's, and an admin gets no exception here", async () => {
    const theirs = await addPasskey('incA', 'cred-b');
    for (const who of ['outA', 'admin']) {
      expect((await as(world, who).patch(`${BASE}/${theirs.id}`, { label: 'mine now' })).status).toBe(404);
      expect((await as(world, who).delete(`${BASE}/${theirs.id}`)).status).toBe(404);
    }
    expect((await passkeyRow('cred-b')).label).toBe('My phone');
  });

  test('a bad id is a validation error', async () => {
    expect((await as(world, 'outA').delete(`${BASE}/not-a-uuid`)).status).toBe(400);
  });
});

describe('admin clear', () => {
  const clearUrl = (id) => `/api/admin/users/${id}/passkeys`;

  test("an admin clears a user's passkeys, and it is audited against that user", async () => {
    await addPasskey('outA', 'cred-1');
    await addPasskey('outA', 'cred-2');
    await addPasskey('incA', 'cred-3');
    const target = world.users.outA.user_id;

    const res = await as(world, 'admin').delete(clearUrl(target));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ removed: 2 });
    expect(await passkeyRow('cred-1')).toBeUndefined();
    expect(await passkeyRow('cred-3')).toBeDefined();

    const [audit] = await auditRows('passkey_removed');
    expect(audit.user_id).toBe(world.users.admin.user_id);
    expect(audit.entity_id).toBe(target);
    expect(audit.new_value).toEqual({ cleared_by_admin: true, count: 2 });
  });

  test('is admin-only', async () => {
    await addPasskey('outA', 'cred-1');
    const url = clearUrl(world.users.outA.user_id);
    expect((await as(world, 'supA').delete(url)).status).toBe(403);
    expect((await as(world, 'outA').delete(url)).status).toBe(403);
    expect((await request(app).delete(url)).status).toBe(401);
    expect(await passkeyRow('cred-1')).toBeDefined();
  });

  test('an unknown user is a 404', async () => {
    expect((await as(world, 'admin').delete(clearUrl('00000000-0000-4000-8000-000000000000'))).status).toBe(404);
  });
});

describe('when WEBAUTHN_* is unset', () => {
  test.each(['WEBAUTHN_RP_ID', 'WEBAUTHN_ORIGIN', 'WEBAUTHN_RP_NAME'])('with %s missing, config says off and every route is 404', async (name) => {
    const mine = await addPasskey('outA', 'cred-1');
    delete process.env[name];

    const cfg = await request(app).get(`${BASE}/config`);
    expect(cfg.status).toBe(200);
    expect(cfg.body).toEqual({ passkeys: false });

    const out = as(world, 'outA');
    const results = await Promise.all([
      request(app).post(`${BASE}/login/options`),
      request(app).post(`${BASE}/login/verify`).send({}),
      request(app).post(`${BASE}/register/options`),
      out.post(`${BASE}/register/options`),
      out.post(`${BASE}/register/verify`, {}),
      out.get(BASE),
      out.patch(`${BASE}/${mine.id}`, { label: 'x' }),
      out.delete(`${BASE}/${mine.id}`),
      as(world, 'admin').delete(`/api/admin/users/${world.users.outA.user_id}/passkeys`),
    ]);
    expect(results.map((r) => r.status)).toEqual(Array(results.length).fill(404));
    expect(await passkeyRow('cred-1')).toBeDefined();

    const pw = await request(app).post('/api/auth/login').send({ identifier: 'T100', password: PASSWORD });
    expect(pw.status).toBe(200);
  });

  test('config says on when all three are set', async () => {
    expect((await request(app).get(`${BASE}/config`)).body).toEqual({ passkeys: true });
  });
});

describe('webauthnConfig', () => {
  const env = (over) => ({
    WEBAUTHN_RP_ID: 'my-site.netlify.app', WEBAUTHN_ORIGIN: 'https://my-site.netlify.app', WEBAUTHN_RP_NAME: 'SHMS', NODE_ENV: 'production', ...over,
  });

  test('accepts an https origin on the RP ID or a subdomain, and drops any trailing slash', () => {
    expect(webauthnConfig(env())).toEqual({ rpID: 'my-site.netlify.app', origin: 'https://my-site.netlify.app', rpName: 'SHMS' });
    expect(webauthnConfig(env({ WEBAUTHN_ORIGIN: 'https://my-site.netlify.app/' })).origin).toBe('https://my-site.netlify.app');
    expect(webauthnConfig(env({ WEBAUTHN_RP_ID: 'netlify.app' }))).not.toBeNull();
  });

  test('allows http://localhost only outside production', () => {
    const local = { WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_ORIGIN: 'http://localhost:5173' };
    expect(webauthnConfig(env({ ...local, NODE_ENV: 'development' })).origin).toBe('http://localhost:5173');
    expect(webauthnConfig(env({ ...local, NODE_ENV: 'test' }))).not.toBeNull();
    expect(webauthnConfig(env(local))).toBeNull();
  });

  test.each([
    ['plain http on another host', { WEBAUTHN_ORIGIN: 'http://my-site.netlify.app', NODE_ENV: 'development' }],
    ['a scheme in the RP ID', { WEBAUTHN_RP_ID: 'https://my-site.netlify.app' }],
    ['an origin that is not on the RP ID', { WEBAUTHN_ORIGIN: 'https://other.example' }],
    ['a look-alike origin', { WEBAUTHN_ORIGIN: 'https://evilmy-site.netlify.app' }],
    ['an origin that is not a URL', { WEBAUTHN_ORIGIN: 'my-site.netlify.app' }],
    ['a blank name', { WEBAUTHN_RP_NAME: '  ' }],
  ])('refuses %s', (_, over) => {
    expect(webauthnConfig(env(over))).toBeNull();
  });
});

describe('rate limits', () => {
  test('sign-in routes are limited per address, with the usual 429', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await loginOptions()).status).toBe(200);
    }
    const res = await loginOptions();
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/too many/i);
    expect((await loginVerify({})).status).toBe(429);
    // Password login keeps its own behaviour.
    expect((await request(app).post('/api/auth/login').send({ identifier: 'T100', password: PASSWORD })).status).toBe(200);
  });

  test('signed-in routes are limited per user', async () => {
    for (let i = 0; i < 30; i += 1) {
      expect((await as(world, 'outA').get(BASE)).status).toBe(200);
    }
    expect((await as(world, 'outA').get(BASE)).status).toBe(429);
    expect((await as(world, 'incA').get(BASE)).status).toBe(200);
  });

  test('config is not limited', async () => {
    for (let i = 0; i < 31; i += 1) await loginOptions();
    expect((await request(app).get(`${BASE}/config`)).status).toBe(200);
  });
});

describe('secrets', () => {
  test('failures log a reason code only: no challenge, key or assertion, in the logs or the audit trail', async () => {
    const lines = [];
    const spies = ['log', 'info', 'warn', 'error'].map((m) => jest.spyOn(console, m).mockImplementation((...a) => lines.push(a.join(' '))));
    try {
      await addPasskey('outA', 'cred-secret-id');
      // A library failure whose message quotes the challenge and the origin.
      const { body } = await loginOptions();
      const { challenge } = body.options;
      await loginVerify({ challenge_id: body.challenge_id, response: assertion('cred-secret-id', { origin: 'https://evil.example', signature: 'SIG-SECRET' }, challenge) });
      await signIn('cred-secret-id', { challenge: 'CHALLENGE-SECRET' });
      await signIn('unknown-secret-id');
      const { body: reg } = await as(world, 'outA').post(`${BASE}/register/options`);
      await as(world, 'outA').post(`${BASE}/register/verify`, {
        challenge_id: reg.challenge_id, response: assertion('cred-new-secret', { origin: 'https://evil.example' }, reg.options.challenge),
      });

      const logged = lines.join('\n');
      expect(logged).toMatch(/passkey_login_failed reason=origin_mismatch/);
      expect(logged).toMatch(/passkey_login_failed reason=challenge_mismatch/);
      expect(logged).toMatch(/passkey_login_failed reason=unknown_credential/);
      expect(logged).toMatch(/passkey_register_failed reason=origin_mismatch/);

      const { rows } = await pool.query('SELECT coalesce(previous_value::text, \'\') || coalesce(new_value::text, \'\') AS v FROM audit_log');
      const audited = rows.map((r) => r.v).join('\n');
      for (const text of [logged, audited]) {
        for (const secret of [challenge, reg.options.challenge, 'CHALLENGE-SECRET', 'SIG-SECRET', 'cred-secret-id', 'unknown-secret-id', 'cred-new-secret', 'evil.example', PUBLIC_KEY.toString('base64')]) {
          expect(text).not.toContain(secret);
        }
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  test('passkey routes are not cacheable', async () => {
    expect((await loginOptions()).headers['cache-control']).toBe('no-store');
    expect((await as(world, 'outA').get(BASE)).headers['cache-control']).toBe('no-store');
  });
});

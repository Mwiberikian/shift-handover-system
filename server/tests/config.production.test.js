// P2: production configuration. In production the server refuses to start
// with JWT_SECRET unset or still change_me; CLIENT_ORIGIN may list several
// origins; trust proxy is set so per-IP rate limits see the client.
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { clientOrigins, trustProxy, productionConfigErrors } = require('../src/config/env');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const GOOD = {
  NODE_ENV: 'production', JWT_SECRET: 'a-long-random-production-secret', CLIENT_ORIGIN: 'https://shms.example', DATABASE_URL: process.env.DATABASE_URL,
};

// Runs the real entry point from a directory with no .env, so only `env`
// configures it. Resolves with the exit code and output, or 'started'.
function boot(env) {
  return new Promise((resolve, reject) => {
    const childEnv = { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, PORT: '0', REMINDERS_ENABLED: 'false', ...env };
    for (const k of Object.keys(childEnv)) if (childEnv[k] === undefined) delete childEnv[k];
    const child = spawn(process.execPath, [SERVER], { cwd: os.tmpdir(), env: childEnv });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no result: ${out}`)); }, 15000);
    const onData = (d) => {
      out += d;
      if (/API running/.test(out)) { clearTimeout(timer); child.kill(); resolve({ code: 'started', out }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

describe('refuses to start in production', () => {
  test('with JWT_SECRET unset', async () => {
    const { code, out } = await boot({ ...GOOD, JWT_SECRET: undefined });
    expect(code).toBe(1);
    expect(out).toMatch(/Refusing to start in production/);
    expect(out).toMatch(/JWT_SECRET is not set/);
  });

  test('with JWT_SECRET equal to change_me', async () => {
    const { code, out } = await boot({ ...GOOD, JWT_SECRET: 'change_me' });
    expect(code).toBe(1);
    expect(out).toMatch(/JWT_SECRET is still the placeholder change_me/);
  });

  test('with CLIENT_ORIGIN unset', async () => {
    const { code, out } = await boot({ ...GOOD, CLIENT_ORIGIN: undefined });
    expect(code).toBe(1);
    expect(out).toMatch(/CLIENT_ORIGIN is not set/);
  });

  test('but starts with a real secret', async () => {
    expect((await boot(GOOD)).code).toBe('started');
  });

  test('outside production a missing secret does not block start-up', async () => {
    expect((await boot({ ...GOOD, NODE_ENV: 'development', JWT_SECRET: undefined })).code).toBe('started');
  });
});

test('productionConfigErrors lists every problem and is empty outside production', () => {
  expect(productionConfigErrors({ NODE_ENV: 'production', JWT_SECRET: ' change_me ' })).toEqual([
    'JWT_SECRET is still the placeholder change_me', 'CLIENT_ORIGIN is not set', 'DATABASE_URL is not set',
  ]);
  expect(productionConfigErrors({ ...GOOD, TRUST_PROXY: 'yes' })).toEqual(["TRUST_PROXY must be a hop count or false, got 'yes'"]);
  expect(productionConfigErrors(GOOD)).toEqual([]);
  expect(productionConfigErrors({ NODE_ENV: 'test' })).toEqual([]);
});

test('CLIENT_ORIGIN accepts a comma-separated list', () => {
  expect(clientOrigins({ CLIENT_ORIGIN: ' https://a.example/ , https://b.example,,' })).toEqual(['https://a.example', 'https://b.example']);
  expect(clientOrigins({})).toEqual([]);
});

test('trust proxy: one hop in production, none elsewhere, TRUST_PROXY wins', () => {
  expect(trustProxy({ NODE_ENV: 'production' })).toBe(1);
  expect(trustProxy({ NODE_ENV: 'development' })).toBe(false);
  expect(trustProxy({ NODE_ENV: 'production', TRUST_PROXY: '2' })).toBe(2);
  expect(trustProxy({ NODE_ENV: 'production', TRUST_PROXY: 'false' })).toBe(false);
});

describe('the app with a production-like environment', () => {
  let app;
  let pool;
  const saved = { ...process.env };
  beforeAll(() => {
    process.env.CLIENT_ORIGIN = 'https://shms.example, https://app.shms.example';
    process.env.TRUST_PROXY = '1';
    jest.isolateModules(() => {
      app = require('../src/app');
      pool = require('../src/config/db');
    });
  });
  afterAll(async () => {
    process.env = saved;
    await pool.end();
  });

  test('allows each listed origin and no other', async () => {
    for (const origin of ['https://shms.example', 'https://app.shms.example']) {
      const res = await request(app).get('/api/health').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
    const other = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('sets trust proxy, so req.ip is the client behind one proxy', () => {
    expect(app.get('trust proxy')).toBe(1);
  });

  test('helmet headers are on', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

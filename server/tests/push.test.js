// R3: Web Push as a notify() channel. web-push is mocked: nothing leaves the
// machine. Checks subscribe/unsubscribe, the payload (title and link only),
// pruning on 404/410, opt-out, sending only after commit, and the types.
jest.mock('web-push', () => ({ sendNotification: jest.fn(), generateVAPIDKeys: jest.fn() }));

const webpush = require('web-push');
const {
  pool, buildWorld, as, submitCompleteRecord,
} = require('./helpers/fixtures');
const { notify } = require('../src/modules/notifications/notify');
const { withTransaction } = require('../src/db/tx');
const { buildPayload, pushConfig } = require('../src/modules/notifications/push/push');
const { productionConfigErrors } = require('../src/config/env');

const ENV = {
  PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: 'BPublicKeyForTests_x', VAPID_PRIVATE_KEY: 'private-key-for-tests', VAPID_SUBJECT: 'mailto:ops@test.example',
};
const saved = {};
const sub = (n) => ({ endpoint: `https://push.example.net/send/device-${n}`, keys: { p256dh: `BKey${n}_abc-def`, auth: `auth${n}` } });

let world;
beforeAll(() => { for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; } });
afterAll(async () => {
  for (const k of Object.keys(ENV)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  await pool.end();
});
beforeEach(async () => {
  world = await buildWorld();
  webpush.sendNotification.mockReset().mockResolvedValue({ statusCode: 201 });
});

// After-commit sends run on a later tick; wait for them to settle.
const settle = () => new Promise((r) => { setTimeout(r, 100); });
const sentTo = () => webpush.sendNotification.mock.calls.map(([s]) => s.endpoint);
const payloads = () => webpush.sendNotification.mock.calls.map(([, p]) => JSON.parse(p));
const subscriptions = async () => (await pool.query('SELECT user_id, endpoint, failed_count, last_success_at FROM push_subscription ORDER BY endpoint')).rows;

describe('subscribing', () => {
  test('config gives the public key; a device subscribes and unsubscribes', async () => {
    const cfg = await as(world, 'incA').get('/api/push/config');
    expect(cfg.body).toEqual({ enabled: true, public_key: ENV.VAPID_PUBLIC_KEY });

    expect((await as(world, 'incA').post('/api/push/subscribe', sub(1))).status).toBe(201);
    expect((await as(world, 'incA').post('/api/push/subscribe', sub(1))).status).toBe(200); // idempotent
    expect(await subscriptions()).toMatchObject([{ user_id: world.users.incA.user_id, endpoint: sub(1).endpoint, failed_count: 0 }]);

    const del = await as(world, 'incA').delete('/api/push/subscribe').send({ endpoint: sub(1).endpoint });
    expect(del.body).toEqual({ subscribed: false, removed: 1 });
    expect(await subscriptions()).toEqual([]);
  });

  test('audits without the endpoint, which works as a capability', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1)).set('User-Agent', 'Phone Browser 1.0');
    const { rows } = await pool.query("SELECT action, new_value FROM audit_log WHERE action LIKE 'push_%'");
    expect(rows).toEqual([{ action: 'push_subscribe', new_value: { user_agent: 'Phone Browser 1.0' } }]);
    expect(JSON.stringify(rows)).not.toContain('push.example.net');
  });

  test('a user cannot remove another user\'s device', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    const del = await as(world, 'outA').delete('/api/push/subscribe').send({ endpoint: sub(1).endpoint });
    expect(del.body.removed).toBe(0);
    expect(await subscriptions()).toHaveLength(1);
  });

  test('a browser that signs in as someone else moves to that user', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await as(world, 'outA').post('/api/push/subscribe', sub(1));
    expect(await subscriptions()).toMatchObject([{ user_id: world.users.outA.user_id }]);
  });

  test('rejects a non-https endpoint and missing keys', async () => {
    expect((await as(world, 'incA').post('/api/push/subscribe', { ...sub(1), endpoint: 'http://push.example.net/x' })).status).toBe(400);
    expect((await as(world, 'incA').post('/api/push/subscribe', { endpoint: sub(1).endpoint, keys: {} })).status).toBe(400);
  });

  test('requires sign-in', async () => {
    const request = require('supertest');
    const { app } = require('./helpers/fixtures');
    expect((await request(app).post('/api/push/subscribe').send(sub(1))).status).toBe(401);
  });
});

describe('sending', () => {
  test('a submitted handover pushes the incoming user a title and a link, nothing else', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await submitCompleteRecord(world);
    await settle();

    expect(sentTo()).toEqual([sub(1).endpoint]);
    const [payload] = payloads();
    expect(payload).toEqual({ title: 'A handover has been submitted', link: '/incoming' });
    // The record's summary, task and names are in the database, never in a push.
    const raw = webpush.sendNotification.mock.calls[0][1];
    for (const text of ['All stands clear', 'GPU on stand 5', 'Test outA', 'Test incA', world.depts.dept_a.name]) {
      expect(raw).not.toContain(text);
    }
    const [, , options] = webpush.sendNotification.mock.calls[0];
    expect(options.vapidDetails).toEqual({ subject: ENV.VAPID_SUBJECT, publicKey: ENV.VAPID_PUBLIC_KEY, privateKey: ENV.VAPID_PRIVATE_KEY });
    expect((await subscriptions())[0].last_success_at).not.toBeNull();
  });

  test('a reminder sends its fixed title only, never its body', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await withTransaction((client) => notify({
      userIds: [world.users.incA.user_id], type: 'reminder', title: 'Handover due soon', body: 'Night shift for Test incA at Department dept_a ends 06:00 EAT',
    }, { db: client, channels: ['email', 'push'] }));
    await settle();
    expect(payloads()).toEqual([{ title: 'Handover due soon', link: '/incoming' }]);
  });

  test('every device of the recipient gets it; other users\' devices do not', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await as(world, 'incA').post('/api/push/subscribe', sub(2));
    await as(world, 'incB').post('/api/push/subscribe', sub(3));
    await submitCompleteRecord(world);
    await settle();
    expect(sentTo().sort()).toEqual([sub(1).endpoint, sub(2).endpoint]);
  });

  test('opt-out is respected: a device that turned push off gets nothing', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await as(world, 'incA').delete('/api/push/subscribe').send({ endpoint: sub(1).endpoint });
    await submitCompleteRecord(world);
    await settle();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('inactive users get nothing', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.incA.user_id]);
    await withTransaction((client) => notify({ userIds: [world.users.incA.user_id], type: 'handover_submitted' }, { db: client, channels: ['push'] }));
    await settle();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('push-eligible types match the email list', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    for (const type of ['handover_acknowledged', 'handover_closed']) {
      await withTransaction((client) => notify({ userIds: [world.users.incA.user_id], type }, { db: client, channels: ['push'] }));
    }
    await settle();
    expect(webpush.sendNotification).not.toHaveBeenCalled();

    process.env.EMAIL_NOTIFICATION_TYPES = 'handover_closed';
    try {
      await withTransaction((client) => notify({ userIds: [world.users.incA.user_id], type: 'handover_closed' }, { db: client, channels: ['push'] }));
      await settle();
      expect(payloads()).toEqual([{ title: 'A handover was closed', link: '/incoming' }]);
    } finally {
      delete process.env.EMAIL_NOTIFICATION_TYPES;
    }
  });
});

describe('after commit only', () => {
  test('nothing is sent while the transaction is open', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await withTransaction(async (client) => {
      await notify({ userIds: [world.users.incA.user_id], type: 'handover_submitted' }, { db: client, channels: ['push'] });
      await settle();
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });
    await settle();
    expect(webpush.sendNotification).toHaveBeenCalledTimes(1);
  });

  test('a rolled-back change sends nothing', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await expect(withTransaction(async (client) => {
      await notify({ userIds: [world.users.incA.user_id], type: 'handover_submitted' }, { db: client, channels: ['push'] });
      throw new Error('fault after notify');
    })).rejects.toThrow('fault after notify');
    await settle();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  test('a failing push service never fails the handover', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    webpush.sendNotification.mockRejectedValue(Object.assign(new Error('boom'), { statusCode: 500 }));
    const record = await submitCompleteRecord(world);
    expect(record.status).toBe('submitted');
    await settle();
    expect((await subscriptions())[0].failed_count).toBe(1);
  });
});

describe('pruning', () => {
  test.each([404, 410])('a %i from the push service deletes the subscription', async (statusCode) => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    await as(world, 'incA').post('/api/push/subscribe', sub(2));
    webpush.sendNotification.mockImplementation(async (s) => {
      if (s.endpoint === sub(1).endpoint) throw Object.assign(new Error('gone'), { statusCode });
      return { statusCode: 201 };
    });
    await submitCompleteRecord(world);
    await settle();
    expect((await subscriptions()).map((s) => s.endpoint)).toEqual([sub(2).endpoint]);
  });

  test('other errors keep the subscription and count the failure', async () => {
    await as(world, 'incA').post('/api/push/subscribe', sub(1));
    webpush.sendNotification.mockRejectedValue(Object.assign(new Error('unavailable'), { statusCode: 503 }));
    await withTransaction((client) => notify({ userIds: [world.users.incA.user_id], type: 'handover_submitted' }, { db: client, channels: ['push'] }));
    await withTransaction((client) => notify({ userIds: [world.users.incA.user_id], type: 'handover_submitted' }, { db: client, channels: ['push'] }));
    await settle();
    expect(await subscriptions()).toMatchObject([{ failed_count: 2 }]);
  });
});

describe('off by default', () => {
  test('PUSH_ENABLED unset: config says off, subscribing is refused, nothing is sent', async () => {
    delete process.env.PUSH_ENABLED;
    try {
      expect(pushConfig().enabled).toBe(false);
      expect((await as(world, 'incA').get('/api/push/config')).body).toEqual({ enabled: false, public_key: null });
      expect((await as(world, 'incA').post('/api/push/subscribe', sub(1))).status).toBe(503);
      await pool.query(
        "INSERT INTO push_subscription (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.example.net/x', 'k', 'a')",
        [world.users.incA.user_id],
      );
      await submitCompleteRecord(world);
      await settle();
      expect(webpush.sendNotification).not.toHaveBeenCalled();
    } finally {
      process.env.PUSH_ENABLED = 'true';
    }
  });

  test('enabled without keys stays off, and production refuses to start', () => {
    expect(pushConfig({ PUSH_ENABLED: 'true' }).enabled).toBe(false);
    expect(productionConfigErrors({
      NODE_ENV: 'production', JWT_SECRET: 'a-real-secret', CLIENT_ORIGIN: 'https://x.example', DATABASE_URL: 'postgres://x', PUSH_ENABLED: 'true', VAPID_PUBLIC_KEY: 'k',
    })).toEqual(['PUSH_ENABLED=true but VAPID_PRIVATE_KEY is not set', 'PUSH_ENABLED=true but VAPID_SUBJECT is not set']);
  });
});

test('buildPayload: only title and link, whatever the notification holds', () => {
  const payload = buildPayload({
    type: 'message', title: 'secret subject', body: 'secret body', ref: { message_id: 'm1' },
  }, 'incoming_staff');
  expect(payload).toEqual({ title: 'You have a new message', link: '/messages' });
  expect(Object.keys(buildPayload({ type: 'handover_escalated' }, 'supervisor'))).toEqual(['title', 'link']);
});

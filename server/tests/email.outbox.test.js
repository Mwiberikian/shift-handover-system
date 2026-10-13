// IR-06: the notification transaction only queues an email_outbox row; the
// jobs tick sends it. A failed send is retried up to three times with
// exponential backoff (1, 2, 4 minutes by default), then marked failed, and
// the outcome is recorded against the notification.
const { notify } = require('../src/modules/notifications/notify');
const { processOutbox, backoffMs } = require('../src/modules/notifications/email/outbox');
const { setTransport } = require('../src/modules/notifications/email/mailer');
const { withTransaction } = require('../src/db/tx');
const logger = require('../src/utils/logger');
const { pool, buildWorld } = require('./helpers/fixtures');

const MIN = 60 * 1000;
const ENV = { EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'test.example', APP_URL: 'https://shms.test.example' };

let world;
let saved;
let sent;
let failNext; // how many upcoming sends throw
beforeEach(async () => {
  world = await buildWorld();
  saved = { ...process.env };
  Object.assign(process.env, ENV);
  sent = [];
  failNext = 0;
  setTransport({
    sendMail: async (m) => {
      if (failNext > 0) { failNext -= 1; throw new Error('connect ECONNREFUSED 127.0.0.1:1025'); }
      sent.push(m);
      return { messageId: `m${sent.length}` };
    },
  });
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = saved;
  setTransport(null);
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => pool.end());

// Rows are queued with the database clock; the Postgres container's clock can
// differ from this machine's by a little, so runs on the real clock look a
// few seconds ahead, and fake clocks start a few seconds ahead too.
const AHEAD = 5000;
const run = () => processOutbox({ now: new Date(Date.now() + AHEAD) });

// Fake only the clock: pg's sockets keep their real timers.
function fakeClock(start = new Date(Date.now() + AHEAD)) {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(start);
  return { advance: (ms) => jest.setSystemTime(Date.now() + ms), now: () => new Date() };
}

const queue = (type = 'handover_submitted', db = pool) => notify(
  { userIds: [world.users.incA.user_id], type, ref: {} },
  { channels: ['email'], db },
);
const outbox = async () => (await pool.query('SELECT * FROM email_outbox')).rows;
const notification = async (id) => (await pool.query('SELECT email_status, email_status_at FROM notification WHERE notification_id = $1', [id])).rows[0];

test('the notification transaction only queues; nothing is sent until the outbox runs', async () => {
  const [row] = await queue();
  expect(sent).toEqual([]);
  const [o] = await outbox();
  expect(o).toMatchObject({
    notification_id: row.notification_id, to_address: 'inca@test.example', status: 'pending', attempts: 0, sent_at: null,
    subject: '[Shift Handover] A handover has been submitted',
  });
  expect(await notification(row.notification_id)).toMatchObject({ email_status: 'pending' });

  const results = await run();
  expect(results).toEqual([{ id: o.id, status: 'sent', attempts: 1 }]);
  expect(sent).toEqual([expect.objectContaining({ to: 'inca@test.example', subject: '[Shift Handover] A handover has been submitted' })]);
  expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 1, last_error: null });
  expect(await notification(row.notification_id)).toMatchObject({ email_status: 'sent' });
});

test('a rolled-back transaction leaves no outbox row', async () => {
  await expect(withTransaction(async (client) => {
    await queue('handover_submitted', client);
    throw new Error('caller failed');
  })).rejects.toThrow('caller failed');
  expect(await outbox()).toEqual([]);
});

test('email off (the default) queues nothing; in-app is still written', async () => {
  delete process.env.EMAIL_ENABLED;
  const rows = await queue();
  expect(rows).toHaveLength(1);
  expect(await outbox()).toEqual([]);
});

test('a recipient outside EMAIL_ALLOWED_DOMAINS is never queued', async () => {
  process.env.EMAIL_ALLOWED_DOMAINS = 'shms.example';
  await queue();
  expect(await outbox()).toEqual([]);
});

test('a failing transport retries at 1, 2 and 4 minutes, then fails for good and records it on the notification', async () => {
  const clock = fakeClock();
  const [row] = await queue();
  failNext = 99;
  const t0 = clock.now().getTime();
  const nextAt = async () => (await outbox())[0].next_attempt_at.getTime() - t0;

  expect(await processOutbox()).toEqual([expect.objectContaining({ status: 'pending', attempts: 1 })]);
  expect(await nextAt()).toBe(1 * MIN);

  clock.advance(59 * 1000);
  expect(await processOutbox()).toEqual([]); // not due yet
  clock.advance(1000);
  expect(await processOutbox()).toEqual([expect.objectContaining({ status: 'pending', attempts: 2 })]);
  expect(await nextAt()).toBe((1 + 2) * MIN);

  clock.advance(2 * MIN);
  expect(await processOutbox()).toEqual([expect.objectContaining({ status: 'pending', attempts: 3 })]);
  expect(await nextAt()).toBe((1 + 2 + 4) * MIN);

  clock.advance(4 * MIN - 1000);
  expect(await processOutbox()).toEqual([]);
  clock.advance(1000);
  expect(await processOutbox()).toEqual([expect.objectContaining({ status: 'failed', attempts: 4 })]);

  const [o] = await outbox();
  expect(o).toMatchObject({ status: 'failed', attempts: 4, last_error: 'connect ECONNREFUSED 127.0.0.1:1025', sent_at: null });
  expect(await notification(row.notification_id)).toMatchObject({ email_status: 'failed' });
  expect((await notification(row.notification_id)).email_status_at.getTime()).toBe(t0 + 7 * MIN);

  clock.advance(60 * MIN);
  expect(await processOutbox()).toEqual([]); // never again
  expect(sent).toEqual([]);
});

test('a send that fails once and then works ends sent after 2 attempts', async () => {
  const clock = fakeClock();
  const [row] = await queue();
  failNext = 1;
  await processOutbox();
  clock.advance(MIN);
  expect(await processOutbox()).toEqual([expect.objectContaining({ status: 'sent', attempts: 2 })]);
  expect((await outbox())[0]).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
  expect(await notification(row.notification_id)).toMatchObject({ email_status: 'sent' });
});

test('the backoff base is configurable (EMAIL_RETRY_BASE_MINUTES)', () => {
  expect([1, 2, 3].map((n) => backoffMs(n))).toEqual([1 * MIN, 2 * MIN, 4 * MIN]);
  process.env.EMAIL_RETRY_BASE_MINUTES = '5';
  expect([1, 2, 3].map((n) => backoffMs(n))).toEqual([5 * MIN, 10 * MIN, 20 * MIN]);
});

test('a refusal at send time (email switched off meanwhile) fails at once without retrying', async () => {
  const [row] = await queue();
  process.env.EMAIL_ENABLED = 'false';
  expect(await run()).toEqual([expect.objectContaining({ status: 'failed', attempts: 1 })]);
  expect(await notification(row.notification_id)).toMatchObject({ email_status: 'failed' });
});

test('two overlapping runs send each email once', async () => {
  await queue();
  await notify({ userIds: [world.users.supA.user_id], type: 'handover_submitted' }, { channels: ['email'] });
  const [a, b] = await Promise.all([run(), run()]);
  expect(a.length + b.length).toBe(2);
  expect(sent.map((m) => m.to).sort()).toEqual(['inca@test.example', 'supa@test.example']);
});

// scripts/retry-failed-emails.js puts failed rows back in the queue and leaves
// every other row alone.
const { notify } = require('../src/modules/notifications/notify');
const { processOutbox } = require('../src/modules/notifications/email/outbox');
const { setTransport } = require('../src/modules/notifications/email/mailer');
const logger = require('../src/utils/logger');
const { retryFailedEmails } = require('../scripts/retry-failed-emails');
const { pool, buildWorld } = require('./helpers/fixtures');

const AHEAD = 5000; // the Postgres container's clock can differ a little
const run = () => processOutbox({ now: new Date(Date.now() + AHEAD) });

let world;
let saved;
let broken;
let sent;
beforeEach(async () => {
  world = await buildWorld();
  saved = { ...process.env };
  Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'test.example' });
  broken = false;
  sent = [];
  setTransport({
    sendMail: async (m) => {
      if (broken) throw new Error('connect ENETUNREACH');
      sent.push(m.to);
      return { messageId: 'x' };
    },
  });
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = saved;
  setTransport(null);
  jest.restoreAllMocks();
});
afterAll(() => pool.end());

const queue = (user) => notify({ userIds: [user.user_id], type: 'handover_submitted', ref: {} }, { channels: ['email'] });
const row = async (notificationId) => (await pool.query(
  `SELECT o.status, o.attempts, n.email_status FROM email_outbox o JOIN notification n USING (notification_id)
    WHERE notification_id = $1`,
  [notificationId],
)).rows[0];

// Fails a row for good, the way four attempts would leave it.
const failForGood = (notificationId) => Promise.all([
  pool.query("UPDATE email_outbox SET status = 'failed', attempts = 4, last_error = 'connect ENETUNREACH' WHERE notification_id = $1", [notificationId]),
  pool.query("UPDATE notification SET email_status = 'failed' WHERE notification_id = $1", [notificationId]),
]);

test('failed rows go back to pending with attempts 0, and are then sent', async () => {
  const [{ notification_id: id }] = await queue(world.users.incA);
  await failForGood(id);

  expect(await retryFailedEmails()).toBe(1);
  expect(await row(id)).toEqual({ status: 'pending', attempts: 0, email_status: 'pending' });

  expect(await run()).toEqual([expect.objectContaining({ status: 'sent', attempts: 1 })]);
  expect(sent).toEqual(['inca@test.example']);
  expect(await row(id)).toEqual({ status: 'sent', attempts: 1, email_status: 'sent' });
});

test('pending and sent rows are left alone', async () => {
  const [{ notification_id: wasSent }] = await queue(world.users.incA);
  await run();
  const [{ notification_id: pending }] = await queue(world.users.supA);
  await pool.query('UPDATE email_outbox SET attempts = 2 WHERE notification_id = $1', [pending]);

  expect(await retryFailedEmails()).toBe(0);
  expect(await row(wasSent)).toEqual({ status: 'sent', attempts: 1, email_status: 'sent' });
  expect(await row(pending)).toEqual({ status: 'pending', attempts: 2, email_status: 'pending' });
});

test('a reset row gets the full set of attempts again if the network is still down', async () => {
  const [{ notification_id: id }] = await queue(world.users.incA);
  await failForGood(id);
  await retryFailedEmails();
  broken = true;
  expect(await run()).toEqual([expect.objectContaining({ status: 'pending', attempts: 1 })]);
});

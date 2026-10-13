// IR-07, fault injection: with the mail gateway down, (1) the in-app
// notification is still delivered, (2) the handover record stays
// 'submitted', and (3) the undelivered alert is flagged on the supervisor
// dashboard for that department.
const { processOutbox } = require('../src/modules/notifications/email/outbox');
const { setTransport } = require('../src/modules/notifications/email/mailer');
const logger = require('../src/utils/logger');
const {
  pool, buildWorld, as, submitCompleteRecord, getRecordRow,
} = require('./helpers/fixtures');

const MIN = 60 * 1000;
const AHEAD = 5000; // see email.outbox.test.js: DB clock vs this machine's clock

let world;
let saved;
let attempts;
beforeEach(async () => {
  world = await buildWorld();
  saved = { ...process.env };
  Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'test.example' });
  attempts = 0;
  // The gateway is down: every send fails as a refused connection would.
  setTransport({ sendMail: async () => { attempts += 1; throw new Error('connect ECONNREFUSED 127.0.0.1:1025'); } });
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = saved;
  setTransport(null);
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(() => pool.end());

// Runs the outbox through every retry (0, +1, +3, +7 minutes) on a fake clock.
async function exhaustRetries() {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(Date.now() + AHEAD);
  for (const step of [0, 1, 2, 4]) {
    jest.setSystemTime(Date.now() + step * MIN);
    await processOutbox();
  }
  jest.useRealTimers();
}

test('submit succeeds without touching the gateway, and queues one email per recipient', async () => {
  const rec = await submitCompleteRecord(world);
  expect(attempts).toBe(0); // the gateway is not called inside the submit
  const { rows } = await pool.query(
    'SELECT o.to_address, o.status FROM email_outbox o JOIN notification n USING (notification_id) WHERE n.record_id = $1 ORDER BY 1',
    [rec.record_id],
  );
  expect(rows).toEqual([{ to_address: 'inca@test.example', status: 'pending' }, { to_address: 'supa@test.example', status: 'pending' }]);
});

test('(1) the in-app notifications are delivered and stay unread after every email attempt fails', async () => {
  const rec = await submitCompleteRecord(world);
  await exhaustRetries();
  expect(attempts).toBe(8); // 2 emails x 4 attempts

  const { rows } = await pool.query(
    "SELECT recipient_id, read_at, email_status FROM notification WHERE record_id = $1 AND type = 'handover_submitted'",
    [rec.record_id],
  );
  expect(rows.map((r) => r.recipient_id).sort()).toEqual([world.users.incA.user_id, world.users.supA.user_id].sort());
  expect(rows.every((r) => r.read_at === null && r.email_status === 'failed')).toBe(true);

  const count = await as(world, 'incA').get('/api/notifications/unread-count');
  expect(count.body.count).toBe(1);
  const list = await as(world, 'incA').get('/api/notifications');
  expect(list.body[0]).toMatchObject({ type: 'handover_submitted', record_id: rec.record_id, email_status: 'failed' });
});

test('(2) the record stays submitted and can still be acknowledged', async () => {
  const rec = await submitCompleteRecord(world);
  await exhaustRetries();
  expect((await getRecordRow(rec.record_id)).status).toBe('submitted');

  const ack = await as(world, 'incA').post(`/api/handovers/${rec.record_id}/acknowledgement`, {});
  expect(ack.status).toBe(200);
  expect(ack.body.status).toBe('acknowledged');
});

test('(3) the supervisor dashboard counts and lists the failed emails for the department only', async () => {
  const rec = await submitCompleteRecord(world);
  const before = await as(world, 'supA').get('/api/dashboard/supervisor');
  expect(before.body.failed_emails).toEqual([]); // queued, not failed yet
  await exhaustRetries();

  const res = await as(world, 'supA').get('/api/dashboard/supervisor');
  const deptA = res.body.departments.find((d) => d.code === 'dept_a');
  expect(deptA.failed_emails).toBe(2);
  expect(res.body.failed_emails).toHaveLength(2);
  for (const f of res.body.failed_emails) {
    expect(f).toMatchObject({
      type: 'handover_submitted', record_id: rec.record_id, attempts: 4, last_error: 'connect ECONNREFUSED 127.0.0.1:1025',
      department_id: world.depts.dept_a.department_id,
    });
    expect(f).not.toHaveProperty('to_address');
  }
  expect(res.body.failed_emails.map((f) => f.recipient_name).sort()).toEqual(['Test incA', 'Test supA']);

  const other = await as(world, 'supB').get('/api/dashboard/supervisor');
  expect(other.body.failed_emails).toEqual([]);
  expect(other.body.departments[0].failed_emails).toBe(0);
  expect((await as(world, 'admin').get('/api/dashboard/supervisor')).body.failed_emails).toHaveLength(2);
});

test('a gateway that comes back delivers what is still pending', async () => {
  await submitCompleteRecord(world);
  await processOutbox({ now: new Date(Date.now() + AHEAD) }); // first attempt fails
  setTransport({ sendMail: async () => ({ messageId: 'ok' }) });
  const done = await processOutbox({ now: new Date(Date.now() + AHEAD + MIN) });
  expect(done.map((d) => d.status)).toEqual(['sent', 'sent']);
  expect((await as(world, 'supA').get('/api/dashboard/supervisor')).body.failed_emails).toEqual([]);
});

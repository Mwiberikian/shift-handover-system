// "Send as" for messages: System notification (default), Email or Both.
// Email and Both are limited to supervisors and admins, rate-limited on their
// own (10 an hour per user by default), respect each recipient's opt-out, and
// never put the message text in the email.
const { processOutbox } = require('../src/modules/notifications/email/outbox');
const { setTransport } = require('../src/modules/notifications/email/mailer');
const { sendLimitStore, emailSendLimitStore } = require('../src/modules/messages/messages.routes');
const logger = require('../src/utils/logger');
const { pool, buildWorld, as } = require('./helpers/fixtures');

const AHEAD = 5000;
const MIN = 60 * 1000;

let world;
let saved;
let sent;
let failing;
beforeEach(async () => {
  world = await buildWorld();
  sendLimitStore.resetAll();
  emailSendLimitStore.resetAll();
  saved = { ...process.env };
  Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'test.example' });
  sent = [];
  failing = false;
  setTransport({
    sendMail: async (m) => {
      if (failing) throw new Error('connect ECONNREFUSED');
      sent.push(m);
      return { messageId: 'x' };
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

const direct = (to, sendAs, body = 'Stand 5 GPU is back in service.') => ({
  recipient_type: 'user', recipient_user_id: to, body, subject: 'GPU update', ...(sendAs && { send_as: sendAs }),
});
const notificationsFor = async (messageId) => (await pool.query(
  `SELECT n.recipient_id, n.read_at, n.sent_at, n.email_status, o.to_address
     FROM notification n LEFT JOIN email_outbox o USING (notification_id)
    WHERE n.message_id = $1 ORDER BY n.recipient_id`,
  [messageId],
)).rows;

describe('who may email', () => {
  test.each(['outA', 'incA'])('%s cannot send as Email or Both (403); System notification still works', async (who) => {
    for (const sendAs of ['email', 'both']) {
      const res = await as(world, who).post('/api/messages', direct(world.users.supA.user_id, sendAs));
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('Only supervisors and administrators can send a message by email');
    }
    expect((await as(world, who).post('/api/messages', direct(world.users.supA.user_id, 'notification'))).status).toBe(201);
    expect((await pool.query('SELECT 1 FROM email_outbox')).rowCount).toBe(0);
  });

  test.each(['supA', 'admin'])('%s can', async (who) => {
    const res = await as(world, who).post('/api/messages', direct(world.users.incA.user_id, 'both'));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ send_as: 'both', recipients: 1, emails_queued: 1 });
  });

  test('an unknown send_as is a 400', async () => {
    const res = await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id, 'fax'));
    expect(res.status).toBe(400);
  });
});

describe('what each option does', () => {
  test('System notification: bell for a direct message, no email (unchanged default)', async () => {
    const { body: m } = await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id));
    expect(m.send_as).toBe('notification');
    expect(await notificationsFor(m.message_id)).toEqual([expect.objectContaining({ read_at: null, email_status: null, to_address: null })]);
  });

  test('Both: unread bell notification and a queued email', async () => {
    const { body: m } = await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id, 'both'));
    expect(await notificationsFor(m.message_id)).toEqual([expect.objectContaining({ read_at: null, email_status: 'pending', to_address: 'inca@test.example' })]);
  });

  test('Email: a queued email, and the tracking bell row starts read', async () => {
    const { body: m } = await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id, 'email'));
    const [n] = await notificationsFor(m.message_id);
    expect(n).toMatchObject({ email_status: 'pending', to_address: 'inca@test.example' });
    expect(n.read_at).toEqual(n.sent_at);
    expect((await as(world, 'incA').get('/api/notifications/unread-count')).body.count).toBe(0);
    expect((await as(world, 'incA').get('/api/messages/unread-count')).body.count).toBe(1); // still unread in Messages
  });

  test('a department broadcast as Both reaches every active member except the sender', async () => {
    await pool.query("UPDATE app_user SET is_active = false WHERE staff_number = 'T100'"); // outA inactive
    const { body: m } = await as(world, 'supA').post('/api/messages', {
      recipient_type: 'department', recipient_department_id: world.depts.dept_a.department_id, body: 'Briefing at 06:00.', send_as: 'both',
    });
    expect(m).toMatchObject({ recipients: 1, emails_queued: 1 });
    expect((await notificationsFor(m.message_id)).map((n) => n.recipient_id)).toEqual([world.users.incA.user_id]);
  });

  test('an organisation-wide Email reaches everyone active but the sender', async () => {
    const { body: m } = await as(world, 'admin').post('/api/messages', { recipient_type: 'organisation', body: 'Fire drill at 14:00.', send_as: 'email' });
    expect(m).toMatchObject({ recipients: 6, emails_queued: 6 });
  });

  test('the email says a message arrived and links to the app; it never contains the subject or text', async () => {
    await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id, 'both', 'Secret: stand 5 GPU code is 4471'));
    await processOutbox({ now: new Date(Date.now() + AHEAD) });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe('[Shift Handover] You have a new message');
    expect(`${sent[0].subject}${sent[0].text}`).not.toMatch(/4471|GPU|Secret/);
  });
});

describe('recipient opt-out', () => {
  test('an opted-out recipient gets no email; with Email their bell row stays unread instead', async () => {
    await as(world, 'incA').patch('/api/auth/me/preferences', { email_notifications: false });
    const { body: m } = await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id, 'email'));
    expect(m).toMatchObject({ recipients: 1, emails_queued: 0 });
    expect(await notificationsFor(m.message_id)).toEqual([expect.objectContaining({ read_at: null, email_status: null, to_address: null })]);
    expect((await as(world, 'incA').get('/api/notifications/unread-count')).body.count).toBe(1);
  });

  test('in a broadcast only the opted-out person is skipped', async () => {
    await as(world, 'incA').patch('/api/auth/me/preferences', { email_notifications: false });
    const { body: m } = await as(world, 'supA').post('/api/messages', {
      recipient_type: 'department', recipient_department_id: world.depts.dept_a.department_id, body: 'Briefing.', send_as: 'both',
    });
    const rows = await notificationsFor(m.message_id);
    expect(rows.find((r) => r.recipient_id === world.users.incA.user_id).to_address).toBeNull();
    expect(rows.find((r) => r.recipient_id === world.users.outA.user_id).to_address).toBe('outa@test.example');
  });
});

test('an Email-only alert whose email finally fails becomes an unread bell notification (IR-07)', async () => {
  const { body: m } = await as(world, 'supA').post('/api/messages', direct(world.users.incA.user_id, 'email'));
  failing = true;
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(Date.now() + AHEAD);
  for (const step of [0, 1, 2, 4]) {
    jest.setSystemTime(Date.now() + step * MIN);
    await processOutbox();
  }
  jest.useRealTimers();
  const [n] = await notificationsFor(m.message_id);
  expect(n).toMatchObject({ email_status: 'failed', read_at: null });
  expect((await as(world, 'incA').get('/api/notifications/unread-count')).body.count).toBe(1);
});

test('Email/Both sends are limited to 10 an hour per user; System notification sends are not affected', async () => {
  const sup = as(world, 'supA');
  for (let i = 0; i < 10; i += 1) {
    expect((await sup.post('/api/messages', direct(world.users.incA.user_id, i % 2 ? 'email' : 'both'))).status).toBe(201);
  }
  const over = await sup.post('/api/messages', direct(world.users.incA.user_id, 'email'));
  expect(over.status).toBe(429);
  expect(over.body.error).toMatch(/too many email messages/);
  expect((await sup.post('/api/messages', direct(world.users.incA.user_id, 'notification'))).status).toBe(201);
  expect((await as(world, 'admin').post('/api/messages', direct(world.users.incA.user_id, 'email'))).status).toBe(201);
});

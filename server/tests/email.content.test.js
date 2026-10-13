// Email content and eligibility: a subject and a short text with the
// notification title and a link to APP_URL only (never handover content,
// message bodies or passwords); a per-user opt-out; a configurable list of
// email-eligible notification types.
const request = require('supertest');
const { buildEmail } = require('../src/modules/notifications/email/content');
const { processOutbox } = require('../src/modules/notifications/email/outbox');
const { setTransport } = require('../src/modules/notifications/email/mailer');
const { runReminderCheck } = require('../src/jobs/reminders');
const { submitLimitStore } = require('../src/modules/accessRequests/accessRequests.routes');
const logger = require('../src/utils/logger');
const {
  pool, app, buildWorld, as, createCompleteDraft, submitCompleteRecord,
} = require('./helpers/fixtures');

const APP_URL = 'https://shms.test.example';
const AHEAD = 5000;

let world;
let saved;
let sent;
beforeEach(async () => {
  world = await buildWorld();
  submitLimitStore.resetAll();
  saved = { ...process.env };
  Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'test.example', APP_URL });
  sent = [];
  setTransport({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } });
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  process.env = saved;
  setTransport(null);
  jest.restoreAllMocks();
});
afterAll(() => pool.end());

const flush = () => processOutbox({ now: new Date(Date.now() + AHEAD) });
const queuedTypes = async () => (await pool.query(
  'SELECT n.type, u.staff_number FROM email_outbox o JOIN notification n USING (notification_id) JOIN app_user u ON u.user_id = n.recipient_id ORDER BY 1, 2',
)).rows.map((r) => `${r.type}:${r.staff_number}`);

describe('content', () => {
  test('subject and text hold only the title and the app link', () => {
    const email = buildEmail({ type: 'handover_submitted', title: null }, { appUrl: APP_URL });
    expect(email.subject).toBe('[Shift Handover] A handover has been submitted');
    expect(email.text).toContain('A handover has been submitted');
    expect(email.text).toContain(APP_URL);
    expect(email.text.match(/https?:\/\/\S+/g)).toEqual([APP_URL]);
  });

  test("a reminder's body (which names people and shifts) is never put in the email", () => {
    const email = buildEmail({
      type: 'reminder', title: 'Handover awaiting your acknowledgement', body: "Achieng Otieno's night shift handover for Ground Operations is waiting",
    }, { appUrl: APP_URL });
    expect(email.subject).toBe('[Shift Handover] Handover awaiting your acknowledgement');
    expect(email.text).not.toMatch(/Achieng|Ground Operations|night shift/);
  });

  test('a real submit sends emails with no summary, task, incident or names in them', async () => {
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/incidents`, {
      title: 'Bird strike on approach', severity: 'high', occurred_at: new Date().toISOString(),
    });
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
    await flush();
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      const all = `${m.subject}\n${m.text}`;
      for (const secret of ['All stands clear', 'Check GPU on stand 5', 'Bird strike', 'Test outA', 'Department dept_a', draft.record_id]) {
        expect(all).not.toContain(secret);
      }
      expect(m.text).toContain(APP_URL);
    }
  });

  test('no email ever carries a temporary password; access approvals send no email at all', async () => {
    const { body: req } = await request(app).post('/api/access-requests').send({
      full_name: 'Amina Wekesa', email: 'amina@test.example', staff_number: 'T555', requested_department_code: 'dept_a',
    });
    const approve = await as(world, 'admin').post(`/api/admin/access-requests/${req.request_id}/approve`, {
      role: 'outgoing_staff', department_id: world.depts.dept_a.department_id,
    });
    const { body: { temporary_password: temp } } = await as(world, 'admin').post(
      `/api/admin/access-requests/${req.request_id}/temporary-password`, { reveal_token: approve.body.temporary_password_reveal.token },
    );
    await submitCompleteRecord(world);
    await flush();
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.map((m) => m.to)).not.toContain('amina@test.example');
    for (const m of sent) expect(`${m.subject}${m.text}`).not.toContain(temp);
  });
});

describe('who and what is emailed', () => {
  test('default types: submitted, queried, clarified, escalated, resolved are emailed; acknowledged and closed are not', async () => {
    const rec = await submitCompleteRecord(world); // submitted -> incA, supA
    await as(world, 'incA').post(`/api/handovers/${rec.record_id}/query`, { comments: 'Which stand?' }); // -> outA
    await as(world, 'outA').post(`/api/handovers/${rec.record_id}/clarify`, { comments: 'Stand 5.' }); // -> incA
    await as(world, 'incA').post(`/api/handovers/${rec.record_id}/acknowledgement`, {}); // -> outA, in-app only
    await as(world, 'supA').post(`/api/handovers/${rec.record_id}/review`, { decision: 'escalated' }); // -> outA, incA
    await as(world, 'supA').post(`/api/handovers/${rec.record_id}/resolve`, {}); // -> outA, incA

    expect(await queuedTypes()).toEqual([
      'handover_clarified:T101',
      'handover_escalated:T100', 'handover_escalated:T101',
      'handover_queried:T100',
      'handover_resolved:T100', 'handover_resolved:T101',
      'handover_submitted:T101', 'handover_submitted:T102',
    ]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM notification WHERE type = 'handover_acknowledged'");
    expect(rows[0].n).toBe(1); // still delivered in-app
  });

  test('an ordinary approval (handover_closed) stays in-app', async () => {
    const rec = await submitCompleteRecord(world);
    await as(world, 'incA').post(`/api/handovers/${rec.record_id}/acknowledgement`, {});
    await pool.query('TRUNCATE email_outbox');
    await as(world, 'supA').post(`/api/handovers/${rec.record_id}/review`, { decision: 'approved' });
    expect(await queuedTypes()).toEqual([]);
  });

  test('reminders are emailed', async () => {
    const shift = world.shifts.dept_a.current;
    await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [shift.shift_id, world.users.outA.user_id]);
    await runReminderCheck(new Date(new Date(shift.end_time).getTime() - 30 * 60 * 1000));
    expect(await queuedTypes()).toEqual(['reminder:T100']);
    await flush();
    expect(sent[0].subject).toBe('[Shift Handover] Handover due soon');
  });

  test('EMAIL_NOTIFICATION_TYPES narrows the list', async () => {
    process.env.EMAIL_NOTIFICATION_TYPES = 'handover_queried';
    const rec = await submitCompleteRecord(world);
    await as(world, 'incA').post(`/api/handovers/${rec.record_id}/query`, { comments: 'Which stand?' });
    expect(await queuedTypes()).toEqual(['handover_queried:T100']);
  });
});

describe('per-user opt-out', () => {
  test('a user can turn email alerts off and on; it is audited and shown in /me', async () => {
    const me = () => as(world, 'incA').get('/api/auth/me');
    expect((await me()).body.email_notifications).toBe(true);

    const off = await as(world, 'incA').patch('/api/auth/me/preferences', { email_notifications: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ email_notifications: false });
    expect((await me()).body.email_notifications).toBe(false);

    const { rows } = await pool.query(
      "SELECT previous_value, new_value FROM audit_log WHERE action = 'update_preferences' AND entity_id = $1", [world.users.incA.user_id],
    );
    expect(rows).toEqual([{ previous_value: { email_notifications: true }, new_value: { email_notifications: false } }]);
    expect((await as(world, 'incA').patch('/api/auth/me/preferences', { email_notifications: 'no' })).status).toBe(400);
  });

  test('an opted-out user still gets the in-app notification but no email', async () => {
    await as(world, 'incA').patch('/api/auth/me/preferences', { email_notifications: false });
    const rec = await submitCompleteRecord(world);
    expect(await queuedTypes()).toEqual(['handover_submitted:T102']);
    const { rows } = await pool.query('SELECT recipient_id, email_status FROM notification WHERE record_id = $1', [rec.record_id]);
    expect(rows.find((r) => r.recipient_id === world.users.incA.user_id)).toMatchObject({ email_status: null });
  });
});

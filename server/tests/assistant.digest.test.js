// End-of-shift digest reminder (Part S): a supervisor gets one, a few minutes
// after the shift ends, with the headline numbers. Driven by an injected clock.
const { pool, buildWorld } = require('./helpers/fixtures');
const { runReminderCheck } = require('../src/jobs/reminders');

const MIN = 60 * 1000;
const START = new Date('2031-03-10T03:00:00Z');
const END = new Date('2031-03-10T15:00:00Z');
const at = (base, minutes) => new Date(base.getTime() + minutes * MIN);

let world; let shift;
beforeEach(async () => {
  world = await buildWorld();
  ({ rows: [shift] } = await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'night', $2, $3) RETURNING *`,
    [world.depts.dept_a.department_id, START, END],
  ));
});
afterEach(() => { delete process.env.ASSISTANT_ENABLED; });
afterAll(() => pool.end());

const digests = (sent) => sent.filter((s) => s.type === 'shift_digest');

test('sent once to each supervisor of the department, 15 minutes after the shift ends', async () => {
  expect(digests(await runReminderCheck(at(END, 14)))).toEqual([]);
  const sent = digests(await runReminderCheck(at(END, 15)));
  expect(sent.map((s) => s.user_id)).toEqual([world.users.supA.user_id]);
  expect(digests(await runReminderCheck(at(END, 15)))).toEqual([]);
  expect(digests(await runReminderCheck(at(END, 20)))).toEqual([]);

  const { rows } = await pool.query("SELECT * FROM notification WHERE reminder_type = 'shift_digest'");
  expect(rows).toHaveLength(1);
  expect(rows[0].recipient_id).toBe(world.users.supA.user_id);
  expect(rows[0].title).toBe('Shift digest');
  expect(rows[0].body).toBe('Department dept_a: no handover for the night shift.');
});

test('the headline carries the real numbers', async () => {
  const { rows: [rec] } = await pool.query(
    `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
     VALUES ($1, $2, $3, $4, 'Digest test record summary text') RETURNING *`,
    [shift.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id, world.users.incA.user_id],
  );
  await pool.query("INSERT INTO incident (record_id, title, severity, occurred_at) VALUES ($1, 'Fuel spill', 'critical', $2)", [rec.record_id, START]);
  await pool.query("UPDATE handover_record SET status = 'submitted', submitted_at = $2 WHERE record_id = $1", [rec.record_id, at(END, -5)]);
  await runReminderCheck(at(END, 15));
  const { rows: [n] } = await pool.query("SELECT body FROM notification WHERE reminder_type = 'shift_digest'");
  expect(n.body).toBe('Department dept_a night shift: 1 handover, 1 unacknowledged, 1 serious incident.');
});

test('not sent when the assistant is switched off', async () => {
  process.env.ASSISTANT_ENABLED = 'false';
  expect(digests(await runReminderCheck(at(END, 15)))).toEqual([]);
  const { rows } = await pool.query("SELECT 1 FROM notification WHERE reminder_type = 'shift_digest'");
  expect(rows).toEqual([]);
});

test('other departments’ supervisors get nothing for this shift', async () => {
  await runReminderCheck(at(END, 15));
  const { rows } = await pool.query("SELECT 1 FROM notification WHERE reminder_type = 'shift_digest' AND recipient_id = $1", [world.users.supB.user_id]);
  expect(rows).toEqual([]);
});

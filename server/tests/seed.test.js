// Part M1: the development seed - 57 synthetic users, a week of shifts with
// rosters, sessions, timers, reports and notifications - and running it twice
// gives the same data set.
const bcrypt = require('bcrypt');
const { pool } = require('./helpers/fixtures');
const {
  seed, ORIGINAL_USERS, DEMO_PASSWORD, DAYS_BACK,
} = require('../src/db/seeds/seed');

const NOW = new Date('2026-10-15T09:30:00Z'); // 12:30 EAT, a day shift
const quiet = () => {};

let first;
beforeAll(async () => {
  first = await seed({ now: NOW, log: quiet });
}, 60000);
afterAll(() => pool.end());

const q = async (sql, params) => (await pool.query(sql, params)).rows;

test('57 users: per department 2 supervisors, 6 outgoing and 6 incoming staff, plus the admin', async () => {
  expect(first.users).toBe(57);
  const rows = await q(
    `SELECT COALESCE(d.code, '-') AS dept, u.role, count(*)::int AS n
       FROM app_user u LEFT JOIN department d USING (department_id) GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const byDept = {};
  for (const r of rows) (byDept[r.dept] ??= {})[r.role] = r.n;
  expect(byDept['-']).toEqual({ admin: 1 });
  for (const code of ['ground_ops', 'maint', 'cust_svc', 'flight_ops']) {
    expect(byDept[code]).toEqual({ supervisor: 2, outgoing_staff: 6, incoming_staff: 6 });
  }
});

test('the original 13 accounts keep their staff numbers, names, emails, roles and password', async () => {
  const rows = await q(
    `SELECT u.staff_number, u.full_name, u.email, u.role, d.code, u.password_hash
       FROM app_user u LEFT JOIN department d USING (department_id) WHERE u.staff_number = ANY($1)`,
    [ORIGINAL_USERS.map(([s]) => s)],
  );
  expect(rows).toHaveLength(13);
  const byStaff = Object.fromEntries(rows.map((r) => [r.staff_number, r]));
  for (const [staff, name, code, role] of ORIGINAL_USERS) {
    expect(byStaff[staff]).toMatchObject({ full_name: name, role, code });
  }
  expect(byStaff.KQ1001.email).toBe('achieng.otieno@shms.example');
  expect(byStaff.KQ9001.email).toBe('system.administrator@shms.example');
  expect(await bcrypt.compare(DEMO_PASSWORD, byStaff.KQ1001.password_hash)).toBe(true);
  const [added] = await q("SELECT password_hash FROM app_user WHERE staff_number = 'KQ4025'");
  expect(await bcrypt.compare(DEMO_PASSWORD, added.password_hash)).toBe(true);
});

test(`shifts from 06:00 EAT ${DAYS_BACK} days ago to the next shift, 3 outgoing and 3 incoming staff on each`, async () => {
  const [span] = await q("SELECT min(start_time) AS first, max(start_time) AS last, count(*)::int AS n FROM shift WHERE department_id = (SELECT department_id FROM department WHERE code = 'maint')");
  expect(span.first.toISOString()).toBe('2026-10-08T03:00:00.000Z'); // 06:00 EAT on 8 October
  expect(span.last.toISOString()).toBe('2026-10-15T15:00:00.000Z'); // tonight's shift (the next one)
  expect(span.n).toBe(2 * DAYS_BACK + 2);
  const perShift = await q(
    `SELECT sa.shift_id, count(*) FILTER (WHERE u.role = 'outgoing_staff')::int AS out, count(*) FILTER (WHERE u.role = 'incoming_staff')::int AS inc
       FROM shift_assignment sa JOIN app_user u USING (user_id) GROUP BY 1`,
  );
  expect(perShift).toHaveLength(4 * (2 * DAYS_BACK + 2));
  for (const s of perShift) expect([s.out, s.inc]).toEqual([3, 3]);
  // As in the first seed: KQ1001 works the current shift, KQ1002 the next one.
  const roster = await q(
    `SELECT u.staff_number, s.start_time FROM shift_assignment sa JOIN app_user u USING (user_id) JOIN shift s USING (shift_id)
      WHERE u.staff_number IN ('KQ1001', 'KQ1002') AND s.start_time >= '2026-10-15T03:00:00Z' ORDER BY 2`,
  );
  expect(roster.map((r) => [r.staff_number, r.start_time.toISOString()])).toEqual([
    ['KQ1001', '2026-10-15T03:00:00.000Z'], ['KQ1002', '2026-10-15T15:00:00.000Z'],
  ]);
});

test('every past shift has a record, six ended sessions, two timers and a shared report; the current shift has two live sessions per department', async () => {
  const pastShifts = 4 * 2 * DAYS_BACK;
  expect(first).toMatchObject({
    records: pastShifts, reports: pastShifts, notifications: pastShifts, timers: 2 * pastShifts, sessions: 6 * pastShifts + 8,
  });
  const [s] = await q('SELECT count(*) FILTER (WHERE ended_at IS NULL)::int AS live, count(DISTINCT end_reason)::int AS reasons FROM work_session');
  expect(s).toEqual({ live: 8, reasons: 3 });
  const [t] = await q('SELECT count(*)::int AS n FROM task_timer t JOIN work_session w USING (session_id) WHERE t.started_at < w.started_at OR t.stopped_at > w.ended_at');
  expect(t.n).toBe(0);
  const [r] = await q("SELECT count(*) FILTER (WHERE status = 'submitted')::int AS submitted, count(*)::int AS n FROM report");
  expect(r).toEqual({ submitted: pastShifts, n: pastShifts });
  const [sh] = await q("SELECT count(*)::int AS n FROM report_share rs JOIN app_user u USING (user_id) WHERE u.role = 'supervisor'");
  expect(sh.n).toBe(pastShifts);
  // Carry-forward demo kept: Ground Ops' previous record has an open task.
  const [open] = await q(
    `SELECT count(*)::int AS n FROM task k JOIN handover_record h USING (record_id) JOIN shift s USING (shift_id)
      WHERE k.status = 'open' AND h.status = 'acknowledged' AND s.start_time = '2026-10-14T15:00:00Z'
        AND h.department_id = (SELECT department_id FROM department WHERE code = 'ground_ops')`,
  );
  expect(open.n).toBe(1);
});

test('all free text is labelled SYNTHETIC', async () => {
  for (const [table, column] of [
    ['handover_record', 'summary_notes'], ['task', 'description'], ['incident', 'title'], ['incident', 'description'],
    ['acknowledgement', 'comments'], ['report', 'title'], ['report', 'done_text'],
  ]) {
    const [row] = await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT LIKE 'SYNTHETIC%'`);
    expect({ table, column, unlabelled: row.n }).toEqual({ table, column, unlabelled: 0 });
  }
  const [n] = await q("SELECT count(*)::int AS n FROM notification WHERE title NOT LIKE '%SYNTHETIC%'");
  expect(n.n).toBe(0);
  const [e] = await q("SELECT count(*)::int AS n FROM app_user WHERE email NOT LIKE '%@shms.example'");
  expect(e.n).toBe(0);
});

test('running it again gives the same data set (idempotent)', async () => {
  const snapshot = async () => ({
    users: await q('SELECT staff_number, full_name, email, role FROM app_user ORDER BY staff_number'),
    shifts: await q('SELECT d.code, s.shift_type, s.start_time FROM shift s JOIN department d USING (department_id) ORDER BY 1, 3'),
    roster: await q('SELECT u.staff_number, s.start_time FROM shift_assignment JOIN app_user u USING (user_id) JOIN shift s USING (shift_id) ORDER BY 1, 2'),
    reports: await q('SELECT r.title, r.done_text, u.staff_number FROM report r JOIN app_user u ON u.user_id = r.author_id ORDER BY 1, 3'),
    sessions: await q('SELECT u.staff_number, w.started_at, w.ended_at, w.end_reason FROM work_session w JOIN app_user u USING (user_id) WHERE w.ended_at IS NOT NULL ORDER BY 1, 2'),
  });
  const before = await snapshot();
  const again = await seed({ now: NOW, log: quiet });
  expect(again).toEqual(first);
  expect(await snapshot()).toEqual(before);
}, 60000);

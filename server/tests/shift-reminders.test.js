// Shift reminders, driven by runReminderCheck(now) with an injected clock, plus
// the roster (shift assignment) API that feeds them.
const request = require('supertest');
const {
  pool, app, buildWorld, as,
} = require('./helpers/fixtures');
const { runReminderCheck } = require('../src/jobs/reminders');

const MIN = 60 * 1000;
// A fixed day shift: 06:00-18:00 Nairobi = 03:00-15:00 UTC, far from "now".
const START = new Date('2031-03-10T03:00:00Z');
const END = new Date('2031-03-10T15:00:00Z');
const at = (base, mins) => new Date(base.getTime() + mins * MIN);

let world;
let shift;
beforeEach(async () => {
  world = await buildWorld();
  ({ rows: [shift] } = await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'day', $2, $3) RETURNING *`,
    [world.depts.dept_a.department_id, START, END],
  ));
  await pool.query(
    'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2), ($1, $3)',
    [shift.shift_id, world.users.outA.user_id, world.users.incA.user_id],
  );
});
afterAll(() => pool.end());

const types = (sent) => sent.map((s) => `${s.type}:${Object.keys(world.users).find((k) => world.users[k].user_id === s.user_id)}`).sort();

// A record for the fixed shift, walked to `status` through legal transitions.
async function recordFor(status) {
  const { rows: [rec] } = await pool.query(
    `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
     VALUES ($1, $2, $3, $4, 'Reminder test record summary text') RETURNING *`,
    [shift.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id, world.users.incA.user_id],
  );
  const path = { draft: [], submitted: ['submitted'], acknowledged: ['submitted', 'acknowledged'] }[status];
  for (const s of path) {
    await pool.query('UPDATE handover_record SET status = $2, submitted_at = COALESCE(submitted_at, $3) WHERE record_id = $1', [rec.record_id, s, at(END, -20)]);
  }
  return rec;
}

describe('shift starting', () => {
  test('fires for assigned staff at the lead time (30 min) and not before', async () => {
    expect(await runReminderCheck(at(START, -31))).toEqual([]);
    expect(types(await runReminderCheck(at(START, -30)))).toEqual(['shift_start:incA', 'shift_start:outA']);
  });

  test('never fires twice, even on repeated or overlapping ticks', async () => {
    // Two ticks racing on fresh state: between them, each reminder goes out once.
    const raced = await Promise.all([runReminderCheck(at(START, -30)), runReminderCheck(at(START, -30))]);
    expect(types(raced.flat())).toEqual(['shift_start:incA', 'shift_start:outA']);
    expect(await runReminderCheck(at(START, -30))).toEqual([]);
    expect(await runReminderCheck(at(START, -29))).toEqual([]);
    expect(await runReminderCheck(at(START, -5))).toEqual([]);
    const { rows: [{ n }] } = await pool.query("SELECT count(*)::int AS n FROM notification WHERE reminder_type = 'shift_start'");
    expect(n).toBe(2);
  });

  test('a first tick long after the due time does not replay an old backlog', async () => {
    expect(await runReminderCheck(at(START, -30 + 61))).toEqual([]);
  });

  test('is written as a notification of type reminder, with the time in Nairobi time', async () => {
    await runReminderCheck(at(START, -30));
    const { rows: [n] } = await pool.query(
      "SELECT type, reminder_type, title, body, shift_id, sent_at FROM notification WHERE recipient_id = $1",
      [world.users.outA.user_id],
    );
    expect(n).toMatchObject({ type: 'reminder', reminder_type: 'shift_start', title: 'Shift starting soon', shift_id: shift.shift_id });
    expect(n.body).toContain('06:00 EAT');
    expect(n.sent_at.toISOString()).toBe(at(START, -30).toISOString());
  });

  test('deactivated staff are not reminded', async () => {
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.incA.user_id]);
    expect(types(await runReminderCheck(at(START, -30)))).toEqual(['shift_start:outA']);
  });
});

describe('handover due', () => {
  test('assigned outgoing staff only, at 30 and at 10 minutes before shift end', async () => {
    expect(await runReminderCheck(at(END, -31))).toEqual([]);
    expect(types(await runReminderCheck(at(END, -30)))).toEqual(['handover_due_first:outA']);
    expect(await runReminderCheck(at(END, -11))).toEqual([]);
    expect(types(await runReminderCheck(at(END, -10)))).toEqual(['handover_due_final:outA']);
    expect(await runReminderCheck(at(END, -10))).toEqual([]);
  });

  test('a draft does not stop the reminder', async () => {
    await recordFor('draft');
    expect(types(await runReminderCheck(at(END, -30)))).toEqual(['handover_due_first:outA']);
  });

  test('no handover-due reminder once the record is submitted', async () => {
    await runReminderCheck(at(END, -30));
    await recordFor('submitted');
    expect((await runReminderCheck(at(END, -10))).filter((s) => s.type.startsWith('handover_due'))).toEqual([]);
  });
});

describe('acknowledgement pending', () => {
  test("reminds the record's incoming user 15 minutes after the incoming shift starts", async () => {
    await recordFor('submitted');
    expect(await runReminderCheck(at(END, 14))).toEqual([]);
    expect(types(await runReminderCheck(at(END, 15)))).toEqual(['ack_pending:incA']);
    expect(await runReminderCheck(at(END, 16))).toEqual([]);
  });

  test('not sent once the handover is acknowledged', async () => {
    await recordFor('acknowledged');
    expect(await runReminderCheck(at(END, 15))).toEqual([]);
  });
});

describe('supervisor alerts', () => {
  test('unacknowledged 2 hours after the incoming shift starts: supervisors of that department, once', async () => {
    const rec = await recordFor('submitted');
    expect((await runReminderCheck(at(END, 119))).filter((s) => s.type === 'supervisor_unacknowledged')).toEqual([]);
    const sent = await runReminderCheck(at(END, 120));
    expect(types(sent.filter((s) => s.type === 'supervisor_unacknowledged'))).toEqual(['supervisor_unacknowledged:supA']);
    expect(sent.find((s) => s.type === 'supervisor_unacknowledged').ref_id).toBe(rec.record_id);
    expect(await runReminderCheck(at(END, 121))).toEqual([]);
  });

  test('no unacknowledged alert once acknowledged', async () => {
    await recordFor('acknowledged');
    expect((await runReminderCheck(at(END, 120))).filter((s) => s.type === 'supervisor_unacknowledged')).toEqual([]);
  });

  test('a shift that ends with no submitted handover alerts the supervisors once, at shift end', async () => {
    expect((await runReminderCheck(at(END, -1))).filter((s) => s.type === 'supervisor_no_handover')).toEqual([]);
    expect(types((await runReminderCheck(END)).filter((s) => s.type === 'supervisor_no_handover'))).toEqual(['supervisor_no_handover:supA']);
    expect((await runReminderCheck(at(END, 5))).filter((s) => s.type === 'supervisor_no_handover')).toEqual([]);
  });

  test('no shift-ended alert when a handover was submitted', async () => {
    await recordFor('submitted');
    expect((await runReminderCheck(END)).filter((s) => s.type === 'supervisor_no_handover')).toEqual([]);
  });

  test('the supervisor dashboard flags the same condition (measured from the incoming shift start)', async () => {
    const now = Date.now();
    const makeShift = async (endMinsAgo) => (await pool.query(
      `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'night', $2, $3) RETURNING shift_id`,
      [world.depts.dept_b.department_id, new Date(now - (endMinsAgo + 720) * MIN), new Date(now - endMinsAgo * MIN)],
    )).rows[0].shift_id;
    const overdueShift = await makeShift(150);
    const recentShift = await makeShift(60);
    for (const sid of [overdueShift, recentShift]) {
      const { rows: [r] } = await pool.query(
        `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
         VALUES ($1, $2, $3, $4, 'Dashboard alignment test record') RETURNING record_id`,
        [sid, world.depts.dept_b.department_id, world.users.outB.user_id, world.users.incB.user_id],
      );
      await pool.query("UPDATE handover_record SET status = 'submitted', submitted_at = now() WHERE record_id = $1", [r.record_id]);
    }
    const dash = await as(world, 'supB').get('/api/dashboard/supervisor');
    expect(dash.body.unacknowledged_alerts.map((a) => a.shift_id)).toEqual([overdueShift]);
    expect(dash.body.unacknowledged_alerts[0].hours_since_shift_start).toBeCloseTo(2.5, 1);
  });
});

describe('roster API', () => {
  test('a supervisor can view and replace assignments for their own department, audited', async () => {
    const sup = as(world, 'supA');
    const get = await sup.get(`/api/shifts/${shift.shift_id}/assignments`);
    expect(get.status).toBe(200);
    expect(get.body.assigned.map((u) => u.user_id).sort()).toEqual([world.users.outA.user_id, world.users.incA.user_id].sort());
    expect(get.body.candidates.map((u) => u.user_id)).toEqual(expect.arrayContaining([world.users.supA.user_id]));
    expect(get.body.candidates.map((u) => u.user_id)).not.toContain(world.users.outB.user_id);

    const put = await sup.put(`/api/shifts/${shift.shift_id}/assignments`, { user_ids: [world.users.outA.user_id, world.users.supA.user_id] });
    expect(put.status).toBe(200);
    expect(put.body.assigned.map((u) => u.user_id).sort()).toEqual([world.users.outA.user_id, world.users.supA.user_id].sort());
    const { rows: [audit] } = await pool.query("SELECT previous_value, new_value FROM audit_log WHERE entity_id = $1 AND action = 'update_assignments'", [shift.shift_id]);
    expect(audit.previous_value.user_ids.sort()).toEqual([world.users.outA.user_id, world.users.incA.user_id].sort());
    expect(audit.new_value.user_ids.sort()).toEqual([world.users.outA.user_id, world.users.supA.user_id].sort());
  });

  test('staff from another department cannot be assigned (400), and nothing changes', async () => {
    const res = await as(world, 'supA').put(`/api/shifts/${shift.shift_id}/assignments`, { user_ids: [world.users.outB.user_id] });
    expect(res.status).toBe(400);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM shift_assignment WHERE shift_id = $1', [shift.shift_id]);
    expect(rows[0].n).toBe(2);
  });

  test("another department's supervisor (403) and non-supervisors (403) cannot manage the roster; admins can", async () => {
    expect((await as(world, 'supB').get(`/api/shifts/${shift.shift_id}/assignments`)).status).toBe(403);
    expect((await as(world, 'supB').put(`/api/shifts/${shift.shift_id}/assignments`, { user_ids: [] })).status).toBe(403);
    expect((await as(world, 'outA').put(`/api/shifts/${shift.shift_id}/assignments`, { user_ids: [] })).status).toBe(403);
    expect((await as(world, 'incA').get('/api/shifts')).status).toBe(403);
    expect((await as(world, 'admin').put(`/api/shifts/${shift.shift_id}/assignments`, { user_ids: [] })).status).toBe(200);
  });

  test('the shift list is limited to the supervisor\'s department', async () => {
    const res = await as(world, 'supB').get('/api/shifts?from=2031-03-01T00:00:00Z&to=2031-04-01T00:00:00Z');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    const own = await as(world, 'supA').get('/api/shifts?from=2031-03-01T00:00:00Z&to=2031-04-01T00:00:00Z');
    expect(own.body.map((s) => s.shift_id)).toEqual([shift.shift_id]);
    expect(own.body[0].assigned).toHaveLength(2);
  });

  test('GET /api/shifts/mine returns the caller\'s current and next rostered shift', async () => {
    const { rows: [current] } = await pool.query(
      `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'day', now() - interval '1 hour', now() + interval '1 hour') RETURNING shift_id`,
      [world.depts.dept_a.department_id],
    );
    await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [current.shift_id, world.users.outA.user_id]);
    const res = await as(world, 'outA').get('/api/shifts/mine');
    expect(res.status).toBe(200);
    expect(res.body.current.shift_id).toBe(current.shift_id);
    expect(res.body.current.handover_status).toBeNull();
    expect(res.body.next.shift_id).toBe(shift.shift_id);
    expect((await request(app).get('/api/shifts/mine')).status).toBe(401);
  });
});

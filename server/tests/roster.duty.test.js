// Phase 3: duty derived from the roster (ROSTER_DUTY_ENABLED).
// Both modes: flag off (and flag on with no roster) behaves exactly as the
// fixed roles always have; flag on with a roster, the people assigned to a
// shift author its handover and the people assigned to the next shift
// acknowledge it, so a person is incoming for one shift and outgoing for the
// next without anyone changing roles.
process.env.ASSISTANT_ENABLED = 'false'; // keep reminder assertions focused
const {
  pool, buildWorld, as, getRecordRow,
} = require('./helpers/fixtures');
const { runReminderCheck } = require('../src/jobs/reminders');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterEach(() => { delete process.env.ROSTER_DUTY_ENABLED; });
afterAll(() => pool.end());

const dutyOn = () => { process.env.ROSTER_DUTY_ENABLED = 'true'; };
const HOUR = 3600 * 1000;

// Another active staff member of dept_a with the given fixed role.
async function addStaff(key, staffNumber, role) {
  const { rows: [u] } = await pool.query(
    `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, 'x', $4, $5) RETURNING *`,
    [staffNumber, `Test ${key}`, `${key.toLowerCase()}@test.example`, role, world.depts.dept_a.department_id],
  );
  world.users[key] = u;
  const jwt = require('jsonwebtoken'); // eslint-disable-line global-require
  world.tokens[key] = jwt.sign(
    { user_id: u.user_id, role: u.role, department_id: u.department_id },
    process.env.JWT_SECRET, { expiresIn: '30m' },
  );
  return u;
}

// The shift after dept_a's current one (the incoming side of its handover).
async function addNextShift(dept = 'dept_a') {
  const cur = world.shifts[dept].current;
  const { rows: [s] } = await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'next', $2, $3) RETURNING *`,
    [world.depts[dept].department_id, cur.end_time, new Date(new Date(cur.end_time).getTime() + 12 * HOUR)],
  );
  world.shifts[dept].next = s;
  return s;
}

const assign = (shift, ...keys) => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) SELECT $1, unnest($2::uuid[])',
  [shift.shift_id, keys.map((k) => world.users[k].user_id)],
);

// A submitted record on dept_a's PREVIOUS shift, named to `incoming`.
async function previousSubmitted(incomingKey = 'incA') {
  const { rows: [rec] } = await pool.query(
    `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
     VALUES ($1, $2, $3, $4, 'Previous shift summary for roster duty tests') RETURNING *`,
    [world.shifts.dept_a.previous.shift_id, world.depts.dept_a.department_id,
      world.users.outA.user_id, world.users[incomingKey].user_id],
  );
  await pool.query(`UPDATE handover_record SET status = 'submitted', submitted_at = now() WHERE record_id = $1`, [rec.record_id]);
  return rec;
}

const createDraft = (key, body = {}) => as(world, key).post('/api/handovers', {
  summary_notes: 'Roster duty test summary, long enough for the template.', ...body,
});

describe('flag off: the fixed roles decide, exactly as before', () => {
  test('incoming staff cannot create; outgoing staff cannot acknowledge; duty config says off', async () => {
    expect((await createDraft('incA')).status).toBe(403);
    const rec = await previousSubmitted('incA');
    expect((await as(world, 'outA').post(`/api/handovers/${rec.record_id}/acknowledgement`, {})).status).toBe(403);
    expect((await as(world, 'incA').get('/api/shifts/duty/config')).body).toEqual({ enabled: false });
  });

  test('even a rostered incoming person is refused while the flag is off', async () => {
    await assign(world.shifts.dept_a.current, 'incA');
    expect((await createDraft('incA')).status).toBe(403);
  });
});

describe('flag on, shift with NO roster: falls back to today’s rules', () => {
  test('outgoing creates as before; incoming is still refused', async () => {
    dutyOn();
    expect((await createDraft('outA', { incoming_user_id: world.users.incA.user_id })).status).toBe(201);
    const res = await createDraft('incA');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Only outgoing staff/);
  });

  test('only the named incoming person may acknowledge', async () => {
    dutyOn();
    await addStaff('incA2', 'T103', 'incoming_staff');
    const rec = await previousSubmitted('incA'); // previous shift's next shift (current) has no roster
    expect((await as(world, 'incA2').post(`/api/handovers/${rec.record_id}/acknowledgement`, {})).status).toBe(403);
    expect((await as(world, 'incA').post(`/api/handovers/${rec.record_id}/acknowledgement`, {})).status).toBe(200);
  });
});

describe('flag on with a roster: duty follows the shift assignments', () => {
  test('a person is incoming for the shift before theirs and outgoing for their own', async () => {
    dutyOn();
    await addStaff('rotA', 'T110', 'incoming_staff'); // fixed role never changes
    await assign(world.shifts.dept_a.current, 'rotA');
    const prev = await previousSubmitted('incA'); // named to somebody else

    // Incoming duty: rostered on the shift after `prev`, so may acknowledge it…
    const ack = await as(world, 'rotA').post(`/api/handovers/${prev.record_id}/acknowledgement`, { comments: 'Read in full.' });
    expect(ack.status).toBe(200);
    // …and the acknowledgement records who actually acknowledged.
    const { rows: [row] } = await pool.query('SELECT incoming_user_id FROM acknowledgement WHERE record_id = $1', [prev.record_id]);
    expect(row.incoming_user_id).toBe(world.users.rotA.user_id);

    // Outgoing duty: authors the handover of their own (current) shift.
    expect((await createDraft('rotA', { incoming_user_id: world.users.incA.user_id })).status).toBe(201);
  });

  test('a person not on the roster is refused, whatever their fixed role', async () => {
    dutyOn();
    await addStaff('rotA', 'T110', 'incoming_staff');
    await assign(world.shifts.dept_a.current, 'rotA');
    const res = await createDraft('outA'); // outgoing_staff, but not rostered
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not on the roster/);
  });

  test('the incoming person is preselected when the next shift rosters exactly one', async () => {
    dutyOn();
    await assign(world.shifts.dept_a.current, 'outA');
    const next = await addNextShift();
    await assign(next, 'incA');

    const meta = await as(world, 'outA').get('/api/handovers/meta');
    expect(meta.body.roster_based_incoming).toBe(true);
    expect(meta.body.suggested_incoming_user_id).toBe(world.users.incA.user_id);

    const res = await createDraft('outA'); // no incoming_user_id sent
    expect(res.status).toBe(201);
    expect(res.body.incoming_user_id).toBe(world.users.incA.user_id);
  });

  test('with several rostered incoming people, any of them may acknowledge and the right name is recorded', async () => {
    dutyOn();
    await addStaff('rotB', 'T111', 'outgoing_staff'); // outgoing role, incoming duty next shift
    await assign(world.shifts.dept_a.current, 'outA');
    const next = await addNextShift();
    await assign(next, 'incA', 'rotB');

    const meta = await as(world, 'outA').get('/api/handovers/meta');
    expect(meta.body.suggested_incoming_user_id).toBeNull();
    expect(meta.body.incoming_staff.map((u) => u.user_id).sort())
      .toEqual([world.users.incA.user_id, world.users.rotB.user_id].sort());

    // The author must still name a receiver, from the roster.
    const bad = await createDraft('outA', { incoming_user_id: world.users.supA.user_id });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/next shift's roster/);

    const { body: draft } = await createDraft('outA', { incoming_user_id: world.users.incA.user_id });
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/tasks`, { description: 'Walk the stands before first wave' });
    expect((await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`)).status).toBe(200);

    // The other rostered person (not named) may still view and acknowledge it.
    expect((await as(world, 'rotB').get(`/api/handovers/${draft.record_id}`)).status).toBe(200);
    expect((await as(world, 'rotB').post(`/api/handovers/${draft.record_id}/acknowledgement`, {})).status).toBe(200);
    const { rows: [row] } = await pool.query('SELECT incoming_user_id FROM acknowledgement WHERE record_id = $1', [draft.record_id]);
    expect(row.incoming_user_id).toBe(world.users.rotB.user_id);
    expect((await getRecordRow(draft.record_id)).incoming_user_id).toBe(world.users.incA.user_id); // the named receiver is history, not rewritten
  });

  test('a rostered incoming person sees the record in their list and export', async () => {
    dutyOn();
    await assign(world.shifts.dept_a.current, 'outA');
    const next = await addNextShift();
    await addStaff('rotB', 'T111', 'outgoing_staff');
    await assign(next, 'rotB');
    const { body: draft } = await createDraft('outA', { incoming_user_id: world.users.rotB.user_id });

    const list = await as(world, 'rotB').get('/api/handovers');
    expect(list.body.map((r) => r.record_id)).toContain(draft.record_id);
    expect((await as(world, 'rotB').get(`/api/handovers/${draft.record_id}/export`)).status).toBe(200);
    // Someone rostered nowhere still sees nothing of it.
    const other = await as(world, 'incA').get('/api/handovers');
    expect(other.body.map((r) => r.record_id)).not.toContain(draft.record_id);
  });

  test('a department or person outside the roster chain is still walled off (RBAC unchanged)', async () => {
    dutyOn();
    await assign(world.shifts.dept_a.current, 'outA');
    const { body: draft } = await createDraft('outA', { incoming_user_id: world.users.incA.user_id });
    expect((await as(world, 'incB').get(`/api/handovers/${draft.record_id}`)).status).toBe(403);
    expect((await as(world, 'outB').get(`/api/handovers/${draft.record_id}`)).status).toBe(403);
    expect((await as(world, 'supB').post(`/api/handovers/${draft.record_id}/approve`, {})).status).toBe(403);
  });
});

describe('flag on: reminders follow the roster', () => {
  const START = new Date('2031-03-10T03:00:00Z');
  const END = new Date('2031-03-10T15:00:00Z');
  const at = (base, mins) => new Date(base.getTime() + mins * 60000);

  test('handover-due goes to every rostered person, whatever their fixed role; flag off only to outgoing_staff', async () => {
    const { rows: [shift] } = await pool.query(
      `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'day', $2, $3) RETURNING *`,
      [world.depts.dept_a.department_id, START, END],
    );
    await pool.query(
      'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2), ($1, $3)',
      [shift.shift_id, world.users.outA.user_id, world.users.incA.user_id],
    );

    // Flag off: only the outgoing_staff member is reminded (today's rule).
    const off = (await runReminderCheck(at(END, -30))).filter((s) => s.type === 'handover_due_first');
    expect(off.map((s) => s.user_id)).toEqual([world.users.outA.user_id]);

    // Flag on (fresh world so the reminder has not fired yet).
    world = await buildWorld();
    dutyOn();
    const { rows: [shift2] } = await pool.query(
      `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'day', $2, $3) RETURNING *`,
      [world.depts.dept_a.department_id, START, END],
    );
    await pool.query(
      'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2), ($1, $3)',
      [shift2.shift_id, world.users.outA.user_id, world.users.incA.user_id],
    );
    const on = (await runReminderCheck(at(END, -30))).filter((s) => s.type === 'handover_due_first');
    expect(on.map((s) => s.user_id).sort()).toEqual([world.users.outA.user_id, world.users.incA.user_id].sort());
  });
});

describe('supervisor assignment: conflict warnings', () => {
  test('an overlapping double assignment is warned about but never refused, and shows in GET', async () => {
    dutyOn();
    const cur = world.shifts.dept_a.current;
    // A second shift overlapping the current one (e.g. a mid-day overlap).
    const { rows: [overlap] } = await pool.query(
      `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'overlap', $2, $3) RETURNING *`,
      [world.depts.dept_a.department_id, cur.start_time, new Date(new Date(cur.start_time).getTime() + 6 * HOUR)],
    );
    await assign(overlap, 'outA');

    const put = await as(world, 'supA').put(`/api/shifts/${cur.shift_id}/assignments`, { user_ids: [world.users.outA.user_id] });
    expect(put.status).toBe(200);
    expect(put.body.warnings).toEqual([
      expect.objectContaining({ user_id: world.users.outA.user_id, shift_id: overlap.shift_id }),
    ]);

    const got = await as(world, 'supA').get(`/api/shifts/${cur.shift_id}/assignments`);
    expect(got.body.conflicts).toEqual([
      expect.objectContaining({ user_id: world.users.outA.user_id, shift_id: overlap.shift_id }),
    ]);

    // Department scoping unchanged: the other department's supervisor is refused.
    expect((await as(world, 'supB').get(`/api/shifts/${cur.shift_id}/assignments`)).status).toBe(403);
  });

  test('non-overlapping shifts raise no warning', async () => {
    dutyOn();
    const cur = world.shifts.dept_a.current;
    const next = await addNextShift(); // starts exactly when current ends
    await assign(next, 'outA');
    const put = await as(world, 'supA').put(`/api/shifts/${cur.shift_id}/assignments`, { user_ids: [world.users.outA.user_id] });
    expect(put.body.warnings).toEqual([]);
  });
});

describe('the Phase 1 interim role switch becomes a fallback', () => {
  test('refused (409) when the department’s current shift has a roster; still works without one', async () => {
    dutyOn();
    // No roster: the interim switch still works as the fallback.
    const ok = await as(world, 'supA').post(`/api/supervisor/users/${world.users.outA.user_id}/role`, { role: 'incoming_staff' });
    expect(ok.status).toBe(200);

    await assign(world.shifts.dept_a.current, 'incA');
    const refused = await as(world, 'supA').post(`/api/supervisor/users/${world.users.outA.user_id}/role`, { role: 'outgoing_staff' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/roster/i);

    // Flag off: unchanged, whatever the roster says.
    delete process.env.ROSTER_DUTY_ENABLED;
    expect((await as(world, 'supA').post(`/api/supervisor/users/${world.users.outA.user_id}/role`, { role: 'outgoing_staff' })).status).toBe(200);
  });
});

describe('duty config endpoint', () => {
  test('reports the flag to any signed-in user', async () => {
    dutyOn();
    expect((await as(world, 'incA').get('/api/shifts/duty/config')).body).toEqual({ enabled: true });
    expect((await as(world, 'admin').get('/api/shifts/duty/config')).body).toEqual({ enabled: true });
  });
});

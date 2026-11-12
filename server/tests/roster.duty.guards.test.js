// Phase 3 (ROSTER_DUTY_ENABLED), second file: the guards added after the
// audit, each checked in BOTH modes.
//   A  conflict data on the roster API only when the flag is on;
//   D  flag off, the handover paths make exactly main's queries (no roster
//      lookups at all);
//   risk 1  assistant access for receivers (and nobody else);
//   risk 2  an author keeps access to their own record off the roster;
//   risk 3  an author can never acknowledge or receive their own handover;
// plus audit entries for Phase 3 actions and department scoping.
// The assistant stays ENABLED here (the first file switches it off).
const { Client } = require('pg');
const jwt = require('jsonwebtoken');
const {
  pool, buildWorld, as,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterEach(() => {
  delete process.env.ROSTER_DUTY_ENABLED;
  jest.restoreAllMocks();
});
afterAll(() => pool.end());

const dutyOn = () => { process.env.ROSTER_DUTY_ENABLED = 'true'; };
const HOUR = 3600 * 1000;

async function addStaff(key, staffNumber, role, dept = 'dept_a') {
  const { rows: [u] } = await pool.query(
    `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, 'x', $4, $5) RETURNING *`,
    [staffNumber, `Test ${key}`, `${key.toLowerCase()}@test.example`, role, world.depts[dept].department_id],
  );
  world.users[key] = u;
  world.tokens[key] = jwt.sign(
    { user_id: u.user_id, role: u.role, department_id: u.department_id },
    process.env.JWT_SECRET, { expiresIn: '30m' },
  );
  return u;
}

async function addNextShift(dept = 'dept_a') {
  const cur = world.shifts[dept].current;
  const { rows: [s] } = await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'next', $2, $3) RETURNING *`,
    [world.depts[dept].department_id, cur.end_time, new Date(new Date(cur.end_time).getTime() + 12 * HOUR)],
  );
  return s;
}

const assign = (shift, ...keys) => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) SELECT $1, unnest($2::uuid[])',
  [shift.shift_id, keys.map((k) => world.users[k].user_id)],
);

const createDraft = (key, body = {}) => as(world, key).post('/api/handovers', {
  summary_notes: 'Roster duty guard test summary, long enough for the template.', ...body,
});

async function submitted(authorKey, incomingKey) {
  const { body: draft } = await createDraft(authorKey, { incoming_user_id: world.users[incomingKey].user_id });
  await as(world, authorKey).post(`/api/handovers/${draft.record_id}/tasks`, { description: 'Walk the stands before first wave' });
  const res = await as(world, authorKey).post(`/api/handovers/${draft.record_id}/submit`);
  expect(res.status).toBe(200);
  return draft;
}

// Every SQL text the app sends while `fn` runs.
async function sqlDuring(fn) {
  const seen = [];
  const original = Client.prototype.query;
  jest.spyOn(Client.prototype, 'query').mockImplementation(function spy(...args) {
    const text = typeof args[0] === 'string' ? args[0] : args[0]?.text;
    if (text) seen.push(text);
    return original.apply(this, args);
  });
  await fn();
  jest.restoreAllMocks();
  return seen;
}

const auditRows = async (where, params) => (await pool.query(
  `SELECT user_id, entity_type, entity_id, action, new_value FROM audit_log WHERE ${where} ORDER BY logged_at`,
  params,
)).rows;

// ---------------------------------------------------------------------------
describe('A: conflict data on the roster API only with the flag on', () => {
  async function overlapping() {
    const cur = world.shifts.dept_a.current;
    const { rows: [o] } = await pool.query(
      `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'overlap', $2, $3) RETURNING *`,
      [world.depts.dept_a.department_id, cur.start_time, new Date(new Date(cur.start_time).getTime() + 6 * HOUR)],
    );
    await assign(o, 'outA');
    return cur;
  }

  test('flag off: GET and PUT answer exactly main\'s shape (no conflicts, no warnings)', async () => {
    const cur = await overlapping();
    const got = await as(world, 'supA').get(`/api/shifts/${cur.shift_id}/assignments`);
    expect(Object.keys(got.body).sort()).toEqual(['assigned', 'candidates', 'shift']);
    const put = await as(world, 'supA').put(`/api/shifts/${cur.shift_id}/assignments`, { user_ids: [world.users.outA.user_id] });
    expect(put.status).toBe(200);
    expect(Object.keys(put.body).sort()).toEqual(['assigned', 'shift']);
  });

  test('flag on: both carry the overlap', async () => {
    dutyOn();
    const cur = await overlapping();
    const got = await as(world, 'supA').get(`/api/shifts/${cur.shift_id}/assignments`);
    expect(got.body.conflicts).toHaveLength(1);
    const put = await as(world, 'supA').put(`/api/shifts/${cur.shift_id}/assignments`, { user_ids: [world.users.outA.user_id] });
    expect(put.body.warnings).toHaveLength(1);
  });

  test('department/current says roster_duty only with the flag on', async () => {
    const off = await as(world, 'incA').get('/api/shifts/department/current');
    expect(off.status).toBe(200);
    expect(off.body).not.toHaveProperty('roster_duty');
    dutyOn();
    expect((await as(world, 'incA').get('/api/shifts/department/current')).body.roster_duty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('D: flag off, the handover paths never consult the roster', () => {
  test('meta, create, update, submit, view, list and acknowledge make no roster or extra shift queries', async () => {
    // A roster exists, so any roster lookup would have something to find.
    await assign(world.shifts.dept_a.current, 'outA', 'incA');
    const sql = await sqlDuring(async () => {
      const meta = await as(world, 'outA').get('/api/handovers/meta');
      expect(Object.keys(meta.body).sort()).toEqual(['current_shift', 'incoming_staff', 'template']);
      const draft = await submitted('outA', 'incA');
      expect((await as(world, 'outA').patch(`/api/handovers/${draft.record_id}`, {})).status).toBeGreaterThanOrEqual(400); // locked after submit
      expect((await as(world, 'incA').get(`/api/handovers/${draft.record_id}`)).status).toBe(200);
      expect((await as(world, 'incA').get('/api/handovers')).status).toBe(200);
      expect((await as(world, 'incA').post(`/api/handovers/${draft.record_id}/acknowledgement`, {})).status).toBe(200);
    });
    expect(sql.filter((q) => /shift_assignment/.test(q))).toEqual([]);
    expect(sql.filter((q) => /SELECT \* FROM shift WHERE shift_id/.test(q))).toEqual([]);
  });

  test('update of the receiver on a draft: no extra shift query flag off, one flag on', async () => {
    const run = async () => {
      const { body: draft } = await createDraft('outA');
      return sqlDuring(async () => {
        const res = await as(world, 'outA').patch(`/api/handovers/${draft.record_id}`, { incoming_user_id: world.users.incA.user_id });
        expect(res.status).toBe(200);
      });
    };
    const shiftLookups = (sql) => sql.filter((q) => /SELECT \* FROM shift WHERE shift_id/.test(q)).length;
    expect(shiftLookups(await run())).toBe(0);

    world = await buildWorld();
    dutyOn();
    expect(shiftLookups(await run())).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('risk 3: an author never receives their own handover', () => {
  test('flag on, double shift: the author is refused at acknowledgement, query, and as named receiver', async () => {
    dutyOn();
    await addStaff('rotA', 'T110', 'incoming_staff');
    await assign(world.shifts.dept_a.current, 'rotA');
    const next = await addNextShift();
    await assign(next, 'rotA', 'incA'); // rotA works the current AND the next shift

    // The author is not offered (nor suggested) as their own receiver…
    const meta = await as(world, 'rotA').get('/api/handovers/meta');
    expect(meta.body.incoming_staff.map((u) => u.user_id)).toEqual([world.users.incA.user_id]);
    expect(meta.body.suggested_incoming_user_id).toBe(world.users.incA.user_id);
    // …and may not name themselves.
    const self = await createDraft('rotA', { incoming_user_id: world.users.rotA.user_id });
    expect(self.status).toBe(400);
    expect(self.body.error).toMatch(/yourself/);

    const draft = await submitted('rotA', 'incA');
    const ack = await as(world, 'rotA').post(`/api/handovers/${draft.record_id}/acknowledgement`, {});
    expect(ack.status).toBe(403);
    expect(ack.body.error).toMatch(/your own handover/);
    const q = await as(world, 'rotA').post(`/api/handovers/${draft.record_id}/query`, { comments: 'Asking myself a question' });
    expect(q.status).toBe(403);
    // The real receiver still can.
    expect((await as(world, 'incA').post(`/api/handovers/${draft.record_id}/acknowledgement`, {})).status).toBe(200);
  });

  test('flag on: when only the author is on the next shift, nobody is preselected', async () => {
    dutyOn();
    await assign(world.shifts.dept_a.current, 'outA');
    const next = await addNextShift();
    await assign(next, 'outA'); // only the author is on the next shift
    const res = await createDraft('outA');
    expect(res.status).toBe(201);
    expect(res.body.incoming_user_id).toBeNull();
  });

  test('flag off: outgoing staff are still stopped at the route, as on main', async () => {
    const draft = await submitted('outA', 'incA');
    expect((await as(world, 'outA').post(`/api/handovers/${draft.record_id}/acknowledgement`, {})).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('risk 2: authors keep access to their own record', () => {
  test('flag on: an incoming-role author taken off the roster can still open and export it', async () => {
    dutyOn();
    await addStaff('rotA', 'T110', 'incoming_staff');
    await assign(world.shifts.dept_a.current, 'rotA');
    const { body: draft } = await createDraft('rotA', { incoming_user_id: world.users.incA.user_id });
    await pool.query('DELETE FROM shift_assignment WHERE user_id = $1', [world.users.rotA.user_id]);

    expect((await as(world, 'rotA').get(`/api/handovers/${draft.record_id}`)).status).toBe(200);
    expect((await as(world, 'rotA').get(`/api/handovers/${draft.record_id}/export`)).status).toBe(200);
    expect((await as(world, 'rotA').get('/api/handovers')).body.map((r) => r.record_id)).toContain(draft.record_id);
  });

  test('flag off: an outgoing author opens their record exactly as before', async () => {
    const { body: draft } = await createDraft('outA', { incoming_user_id: world.users.incA.user_id });
    expect((await as(world, 'outA').get(`/api/handovers/${draft.record_id}`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('risk 1: assistant access for receivers', () => {
  async function rosteredHandover() {
    await addStaff('rotB', 'T111', 'outgoing_staff'); // outgoing ROLE, incoming DUTY
    await assign(world.shifts.dept_a.current, 'outA');
    const next = await addNextShift();
    await assign(next, 'rotB', 'incA'); // incA is named; rotB receives by roster only
    return submitted('outA', 'incA');
  }

  test('flag on: a rostered receiver may use the record checks; suggestions stay with the author', async () => {
    dutyOn();
    const rec = await rosteredHandover();
    expect((await as(world, 'rotB').get(`/api/assistant/handovers/${rec.record_id}/check`)).status).toBe(200);
    expect((await as(world, 'rotB').get(`/api/assistant/handovers/${rec.record_id}/recurring`)).status).toBe(200);
    expect((await as(world, 'rotB').get(`/api/assistant/handovers/${rec.record_id}/suggestions`)).status).toBe(403);
    expect((await as(world, 'outA').get(`/api/assistant/handovers/${rec.record_id}/suggestions`)).status).toBe(200);
  });

  test('flag on: staff neither rostered nor named are refused, even in the same department', async () => {
    dutyOn();
    const rec = await rosteredHandover();
    await addStaff('incA2', 'T103', 'incoming_staff');
    expect((await as(world, 'incA2').get(`/api/assistant/handovers/${rec.record_id}/check`)).status).toBe(403);
    expect((await as(world, 'incB').get(`/api/assistant/handovers/${rec.record_id}/check`)).status).toBe(403);
  });

  test('flag off: incoming staff are stopped at the route, as on main', async () => {
    const rec = await submitted('outA', 'incA');
    expect((await as(world, 'incA').get(`/api/assistant/handovers/${rec.record_id}/check`)).status).toBe(403);
    expect((await as(world, 'outA').get(`/api/assistant/handovers/${rec.record_id}/check`)).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('audit entries for Phase 3 actions', () => {
  test('roster-authored create, roster acknowledgement and roster assignment are each audited under the acting person', async () => {
    dutyOn();
    await addStaff('rotA', 'T110', 'incoming_staff');
    await addStaff('rotB', 'T111', 'outgoing_staff');
    const put = await as(world, 'supA').put(`/api/shifts/${world.shifts.dept_a.current.shift_id}/assignments`, { user_ids: [world.users.rotA.user_id] });
    expect(put.status).toBe(200);
    const next = await addNextShift();
    await assign(next, 'incA', 'rotB');

    const draft = await submitted('rotA', 'incA'); // incoming-role author, by roster
    const ack = await as(world, 'rotB').post(`/api/handovers/${draft.record_id}/acknowledgement`, { comments: 'Taken over.' });
    expect(ack.status).toBe(200);

    const [assignment] = await auditRows("entity_type = 'shift' AND action = 'update_assignments' AND entity_id = $1", [world.shifts.dept_a.current.shift_id]);
    expect(assignment.user_id).toBe(world.users.supA.user_id);
    expect(assignment.new_value.user_ids).toEqual([world.users.rotA.user_id]);

    const recordAudit = await auditRows("entity_type = 'handover_record' AND entity_id = $1", [draft.record_id]);
    expect(recordAudit.find((a) => a.action === 'create').user_id).toBe(world.users.rotA.user_id);
    expect(recordAudit.find((a) => a.action === 'acknowledge').user_id).toBe(world.users.rotB.user_id);

    const [ackAudit] = await auditRows("entity_type = 'acknowledgement' AND action = 'create' AND new_value->>'record_id' = $1", [draft.record_id]);
    expect(ackAudit.user_id).toBe(world.users.rotB.user_id);
    expect(ackAudit.new_value.incoming_user_id).toBe(world.users.rotB.user_id);
  });

  test('a refused role switch (roster duty) writes no audit entry', async () => {
    dutyOn();
    await assign(world.shifts.dept_a.current, 'incA');
    const res = await as(world, 'supA').post(`/api/supervisor/users/${world.users.outA.user_id}/role`, { role: 'incoming_staff' });
    expect(res.status).toBe(409);
    expect(await auditRows('entity_id = $1', [world.users.outA.user_id])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('department scoping', () => {
  test('flag on: someone from another department on this roster gains nothing', async () => {
    dutyOn();
    await assign(world.shifts.dept_a.current, 'outA');
    const next = await addNextShift();
    await assign(next, 'incA', 'incB'); // incB (dept_b) slipped onto dept_a's roster directly
    const draft = await submitted('outA', 'incA');

    expect((await as(world, 'incB').get(`/api/handovers/${draft.record_id}`)).status).toBe(403);
    expect((await as(world, 'incB').post(`/api/handovers/${draft.record_id}/acknowledgement`, {})).status).toBe(403);
    expect((await as(world, 'incB').get('/api/handovers')).body.map((r) => r.record_id)).not.toContain(draft.record_id);
    expect((await as(world, 'incB').get(`/api/assistant/handovers/${draft.record_id}/check`)).status).toBe(403);
  });

  test('both modes: another department\'s supervisor cannot read or change this roster', async () => {
    for (const on of [false, true]) {
      if (on) dutyOn();
      const cur = world.shifts.dept_a.current;
      expect((await as(world, 'supB').get(`/api/shifts/${cur.shift_id}/assignments`)).status).toBe(403);
      expect((await as(world, 'supB').put(`/api/shifts/${cur.shift_id}/assignments`, { user_ids: [] })).status).toBe(403);
    }
  });
});

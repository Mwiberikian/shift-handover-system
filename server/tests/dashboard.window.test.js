// FR-14: the dashboard shows status counts, acknowledgement completion rates
// and outstanding items for the current and preceding shifts; scope=all
// shows every record.
const {
  pool, buildWorld, as, insertRecordWithStatus,
} = require('./helpers/fixtures');

const HOUR = 3600 * 1000;

let world;
let older; // a shift before the preceding one
beforeEach(async () => {
  world = await buildWorld();
  const prev = world.shifts.dept_a.previous;
  const { rows: [s] } = await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'older', $2, $3) RETURNING *`,
    [world.depts.dept_a.department_id, new Date(new Date(prev.start_time).getTime() - 12 * HOUR), prev.start_time],
  );
  older = s;
  // A future shift must never count as "current".
  await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'next', $2, $3)`,
    [world.depts.dept_a.department_id, world.shifts.dept_a.current.end_time, new Date(new Date(world.shifts.dept_a.current.end_time).getTime() + 12 * HOUR)],
  );
});
afterAll(() => pool.end());

const deptA = (res) => res.body.departments.find((d) => d.code === 'dept_a');

// A dept_a record on the 'older' shift, walked to `status`.
async function olderRecord(status) {
  const { rows: [record] } = await pool.query(
    `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
     VALUES ($1, $2, $3, $4, 'Older shift summary for testing purposes') RETURNING *`,
    [older.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id, world.users.incA.user_id],
  );
  const path = { submitted: ['submitted'], closed: ['submitted', 'acknowledged', 'closed'] }[status] || [];
  for (const st of path) await pool.query('UPDATE handover_record SET status = $2, submitted_at = COALESCE(submitted_at, now()) WHERE record_id = $1', [record.record_id, st]);
  return record;
}

test('by default only the current and preceding shift are counted', async () => {
  await insertRecordWithStatus(world, { shift: 'current', status: 'submitted' });
  await insertRecordWithStatus(world, { shift: 'previous', status: 'closed' });
  await olderRecord('closed');

  const res = await as(world, 'supA').get('/api/dashboard/supervisor');
  expect(res.status).toBe(200);
  expect(res.body.scope).toBe('current');
  expect(deptA(res)).toMatchObject({ submitted: 1, closed: 1, open: 1 });
  expect(deptA(res).window_shifts.map((s) => s.shift_id)).toEqual([
    world.shifts.dept_a.current.shift_id, world.shifts.dept_a.previous.shift_id,
  ]);
});

test('scope=all counts every record', async () => {
  await insertRecordWithStatus(world, { shift: 'current', status: 'submitted' });
  await insertRecordWithStatus(world, { shift: 'previous', status: 'closed' });
  await olderRecord('closed');

  const res = await as(world, 'supA').get('/api/dashboard/supervisor?scope=all');
  expect(res.body.scope).toBe('all');
  expect(deptA(res)).toMatchObject({ submitted: 1, closed: 2 });
  expect((await as(world, 'supA').get('/api/dashboard/supervisor?scope=week')).status).toBe(400);
});

test('acknowledgement completion rate = acknowledged or later / submitted or later, per department', async () => {
  await insertRecordWithStatus(world, { shift: 'current', status: 'submitted' });
  await insertRecordWithStatus(world, { shift: 'previous', status: 'acknowledged' });
  await insertRecordWithStatus(world, { dept: 'dept_b', shift: 'previous', status: 'closed' });
  await olderRecord('submitted');

  const res = await as(world, 'admin').get('/api/dashboard/supervisor');
  // dept_a window: 1 submitted + 1 acknowledged -> 1 / 2. The older submitted one is outside.
  expect(deptA(res)).toMatchObject({ acknowledgement_due: 2, acknowledgement_done: 1, acknowledgement_rate: 0.5 });
  expect(res.body.departments.find((d) => d.code === 'dept_b')).toMatchObject({ acknowledgement_rate: 1 });

  const all = await as(world, 'admin').get('/api/dashboard/supervisor?scope=all');
  expect(deptA(all)).toMatchObject({ acknowledgement_due: 3, acknowledgement_done: 1 });
  expect(deptA(all).acknowledgement_rate).toBeCloseTo(1 / 3);
});

test('drafts are not counted as due; no submissions gives a null rate', async () => {
  await insertRecordWithStatus(world, { shift: 'current', status: 'draft' });
  const res = await as(world, 'supA').get('/api/dashboard/supervisor');
  expect(deptA(res)).toMatchObject({ draft: 1, acknowledgement_due: 0, acknowledgement_rate: null });
});

test('overdue items outside the window are not listed but are counted as older_outstanding', async () => {
  const stale = await olderRecord('submitted'); // its shift ended > 12 h ago
  const res = await as(world, 'supA').get('/api/dashboard/supervisor');
  expect(res.body.unacknowledged_alerts).toEqual([]);
  expect(deptA(res).unacknowledged_overdue).toBe(0);
  expect(res.body.older_outstanding).toBe(1);

  const all = await as(world, 'supA').get('/api/dashboard/supervisor?scope=all');
  expect(all.body.unacknowledged_alerts.map((a) => a.record_id)).toEqual([stale.record_id]);
  expect(all.body.older_outstanding).toBe(0);
});

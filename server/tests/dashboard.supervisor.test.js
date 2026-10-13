// FR-14: the supervisor dashboard shows handover status counts and
// outstanding (overdue unacknowledged) items for the supervisor's department.
const {
  pool, buildWorld, as, insertRecordWithStatus,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const dept = (body, code) => body.departments.find((d) => d.code === code);

test("counts records by status for the supervisor's own department only", async () => {
  await insertRecordWithStatus(world, { shift: 'previous', status: 'closed' });
  await insertRecordWithStatus(world, { shift: 'previous', status: 'acknowledged' });
  await insertRecordWithStatus(world, { shift: 'current', status: 'draft' });
  await insertRecordWithStatus(world, { dept: 'dept_b', status: 'submitted' });

  const res = await as(world, 'supA').get('/api/dashboard/supervisor');
  expect(res.status).toBe(200);
  expect(res.body.departments.map((d) => d.code)).toEqual(['dept_a']);
  // draft, submitted and acknowledged differ, so a swapped column is caught.
  expect(dept(res.body, 'dept_a')).toMatchObject({
    open: 2, draft: 1, submitted: 0, queried: 0, acknowledged: 1, under_review: 0, escalated: 0, closed: 1, unacknowledged_overdue: 0,
  });
  expect(res.body.threshold_hours).toBe(2);
});

test('admins see every department', async () => {
  await insertRecordWithStatus(world, { dept: 'dept_b', status: 'submitted' });
  const res = await as(world, 'admin').get('/api/dashboard/supervisor');
  expect(res.body.departments.map((d) => d.code).sort()).toEqual(['dept_a', 'dept_b']);
  expect(dept(res.body, 'dept_b').submitted).toBe(1);
});

test('a submitted record still unacknowledged 2 h after the incoming shift started is listed as outstanding', async () => {
  // The previous shift ended when the current one started; move it back so
  // its end (= incoming shift start) is more than 2 h ago.
  const prev = world.shifts.dept_a.previous;
  await pool.query(
    "UPDATE shift SET start_time = start_time - interval '3 hours', end_time = now() - interval '150 minutes' WHERE shift_id = $1",
    [prev.shift_id],
  );
  const { record } = await insertRecordWithStatus(world, { shift: 'previous', status: 'submitted' });

  const res = await as(world, 'supA').get('/api/dashboard/supervisor');
  expect(dept(res.body, 'dept_a').unacknowledged_overdue).toBe(1);
  expect(res.body.unacknowledged_alerts).toEqual([expect.objectContaining({ record_id: record.record_id, overdue_unacknowledged: true })]);
});

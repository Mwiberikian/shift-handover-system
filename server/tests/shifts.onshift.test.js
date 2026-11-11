// Phase 1 roster visibility: GET /api/shifts/department/current — the "Who
// is on shift" card. Any signed-in user sees the current and next shift of
// their OWN department only, with assignees' names and staff numbers and
// nothing else. 404 while SUPERVISOR_CONTROLS_ENABLED=false.
const { pool, buildWorld, as } = require('./helpers/fixtures');

const HOUR = 3600 * 1000;
let world;
beforeEach(async () => { world = await buildWorld(); });
afterEach(() => { delete process.env.SUPERVISOR_CONTROLS_ENABLED; });
afterAll(() => pool.end());

const assign = (who, shift) => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)',
  [shift.shift_id, world.users[who].user_id],
);
const get = (who) => as(world, who).get('/api/shifts/department/current');

// The fixture world has a previous and a current shift; add the next one.
async function insertNextShift(dept = 'dept_a') {
  const start = new Date(new Date(world.shifts[dept].current.end_time).getTime());
  const { rows: [shift] } = await pool.query(
    `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, 'next', $2, $3) RETURNING *`,
    [world.depts[dept].department_id, start, new Date(start.getTime() + 12 * HOUR)],
  );
  return shift;
}

test('names and staff numbers of the current and next shift of the caller\'s own department, nothing more', async () => {
  const next = await insertNextShift();
  await assign('outA', world.shifts.dept_a.current);
  await assign('incA', world.shifts.dept_a.current);
  await assign('incA', next);

  const res = await get('outA');
  expect(res.status).toBe(200);
  expect(res.body.current.shift_id).toBe(world.shifts.dept_a.current.shift_id);
  expect(res.body.current.assignees).toEqual([
    { full_name: 'Test incA', staff_number: 'T101' },
    { full_name: 'Test outA', staff_number: 'T100' },
  ]);
  expect(res.body.next.shift_id).toBe(next.shift_id);
  expect(res.body.next.assignees).toEqual([{ full_name: 'Test incA', staff_number: 'T101' }]);
  // Names and staff numbers only: no user ids, roles or emails leak.
  for (const a of [...res.body.current.assignees, ...res.body.next.assignees]) {
    expect(Object.keys(a).sort()).toEqual(['full_name', 'staff_number']);
  }
});

test('inactive assignees are left out', async () => {
  await assign('outA', world.shifts.dept_a.current);
  await assign('incA', world.shifts.dept_a.current);
  await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.incA.user_id]);
  const res = await get('outA');
  expect(res.body.current.assignees).toEqual([{ full_name: 'Test outA', staff_number: 'T100' }]);
});

test('scoped to the caller\'s own department; every signed-in role of a department may look', async () => {
  await assign('outA', world.shifts.dept_a.current);
  await assign('outB', world.shifts.dept_b.current);
  expect((await get('outB')).body.current.assignees).toEqual([{ full_name: 'Test outB', staff_number: 'T200' }]);
  expect((await get('supA')).body.current.assignees).toEqual([{ full_name: 'Test outA', staff_number: 'T100' }]);
  expect((await get('incA')).status).toBe(200);
});

test('a caller without a department (admin) gets empty shifts', async () => {
  const res = await get('admin');
  expect(res.status).toBe(200);
  expect(res.body.current).toBeNull();
  expect(res.body.next).toBeNull();
});

test('404 while SUPERVISOR_CONTROLS_ENABLED=false; signed-out callers get 401 when on', async () => {
  process.env.SUPERVISOR_CONTROLS_ENABLED = 'false';
  expect((await get('outA')).status).toBe(404);
  delete process.env.SUPERVISOR_CONTROLS_ENABLED;
  const request = require('supertest');
  const app = require('../src/app');
  expect((await request(app).get('/api/shifts/department/current')).status).toBe(401);
});

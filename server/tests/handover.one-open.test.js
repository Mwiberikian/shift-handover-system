// DR-05: at most one handover record may be open for any department and
// shift, enforced by a database uniqueness constraint
// (handover_record_one_open_per_shift, partial: status <> 'closed').
const {
  pool, buildWorld, as, insertRecordWithStatus,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const openCount = async (dept, shift) => Number((await pool.query(
  "SELECT count(*) FROM handover_record WHERE department_id = $1 AND shift_id = $2 AND status <> 'closed'",
  [world.depts[dept].department_id, world.shifts[dept][shift].shift_id],
)).rows[0].count);

test('a second open record for the same department and shift is refused with 409', async () => {
  const first = await as(world, 'outA').post('/api/handovers', {});
  expect(first.status).toBe(201);

  const second = await as(world, 'outA').post('/api/handovers', { summary_notes: 'Second attempt' });
  expect(second.status).toBe(409);
  expect(second.body.error).toBe('An open handover record already exists for this department and shift');
  expect(await openCount('dept_a', 'current')).toBe(1);
});

test('the refusal comes from the database: a direct INSERT is rejected by the unique index', async () => {
  await insertRecordWithStatus(world, { shift: 'current', status: 'submitted' });
  await expect(pool.query(
    'INSERT INTO handover_record (shift_id, department_id, outgoing_user_id) VALUES ($1, $2, $3)',
    [world.shifts.dept_a.current.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id],
  )).rejects.toMatchObject({ code: '23505', constraint: 'handover_record_one_open_per_shift' });
  expect(await openCount('dept_a', 'current')).toBe(1);
});

test('every open status blocks a second record; only a closed one does not', async () => {
  for (const status of ['draft', 'submitted', 'acknowledged']) {
    world = await buildWorld();
    await insertRecordWithStatus(world, { shift: 'current', status });
    expect((await as(world, 'outA').post('/api/handovers', {})).status).toBe(409);
  }
  world = await buildWorld();
  await insertRecordWithStatus(world, { shift: 'current', status: 'closed' });
  expect((await as(world, 'outA').post('/api/handovers', {})).status).toBe(201);
});

test('other departments and other shifts are unaffected', async () => {
  expect((await as(world, 'outA').post('/api/handovers', {})).status).toBe(201);
  expect((await as(world, 'outB').post('/api/handovers', {})).status).toBe(201);
  await insertRecordWithStatus(world, { shift: 'previous', status: 'submitted' });
  expect(await openCount('dept_a', 'previous')).toBe(1);
  expect(await openCount('dept_a', 'current')).toBe(1);
});

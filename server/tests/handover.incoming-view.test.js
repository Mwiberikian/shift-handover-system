// FR-11: the assigned incoming staff member sees the full record: tasks,
// incidents and the items carried forward from the previous shift.
const {
  pool, buildWorld, as, createCompleteDraft, insertRecordWithStatus,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

test('the assigned incoming user sees tasks, incidents and carried-forward items', async () => {
  const prev = await insertRecordWithStatus(world, {
    status: 'acknowledged', tasks: [{ description: 'Unfinished from last shift', status: 'open' }],
  });
  const draft = await createCompleteDraft(world);
  const out = as(world, 'outA');
  await out.post(`/api/handovers/${draft.record_id}/incidents`, {
    title: 'Hydraulic leak on tug 4', severity: 'medium', occurred_at: new Date().toISOString(),
  });
  expect((await out.post(`/api/handovers/${draft.record_id}/submit`)).status).toBe(200);

  const res = await as(world, 'incA').get(`/api/handovers/${draft.record_id}`);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'submitted', incoming_user_id: world.users.incA.user_id });
  expect(res.body.tasks.map((t) => t.description).sort()).toEqual(['Check GPU on stand 5', 'Unfinished from last shift']);
  const carried = res.body.tasks.find((t) => t.carried_from_task_id);
  expect(carried).toMatchObject({ carried_from_task_id: prev.tasks[0].task_id, carried_from_record_id: prev.record.record_id });
  expect(res.body.incidents).toEqual([expect.objectContaining({ title: 'Hydraulic leak on tug 4', severity: 'medium' })]);
  expect(res.body.template.department_code).toBe('dept_a');
});

test('the incoming list holds only records assigned to the caller', async () => {
  const mine = await insertRecordWithStatus(world, { status: 'submitted' });
  await insertRecordWithStatus(world, { dept: 'dept_b', status: 'submitted' });
  const res = await as(world, 'incA').get('/api/handovers');
  expect(res.status).toBe(200);
  expect(res.body.map((r) => r.record_id)).toEqual([mine.record.record_id]);
});

// On submit, unresolved tasks from the department's previous non-closed record
// are copied onto the new record, linked via carried_from_task_id.
const {
  pool, buildWorld, as, createCompleteDraft, insertRecordWithStatus,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const PREVIOUS_TASKS = [
  { description: 'Open task', status: 'open', priority: 'high' },
  { description: 'Ongoing task', status: 'in_progress', priority: 'medium' },
  { description: 'Finished task', status: 'resolved', priority: 'low' },
];

async function submitNew() {
  const draft = await createCompleteDraft(world);
  const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
  expect(res.status).toBe(200);
  return res.body;
}

test('open and in_progress tasks are carried forward with carried_from_task_id', async () => {
  const prev = await insertRecordWithStatus(world, { status: 'acknowledged', tasks: PREVIOUS_TASKS });
  const submitted = await submitNew();

  const carried = submitted.tasks.filter((t) => t.carried_from_task_id);
  expect(submitted.carried_forward).toBe(2);
  expect(carried).toHaveLength(2);

  const byOrigin = Object.fromEntries(prev.tasks.map((t) => [t.task_id, t]));
  for (const c of carried) {
    const origin = byOrigin[c.carried_from_task_id];
    expect(origin).toBeDefined();
    expect(c).toMatchObject({ description: origin.description, status: origin.status, priority: origin.priority });
    expect(c.record_id).toBe(submitted.record_id);
    expect(c.carried_from_record_id).toBe(prev.record.record_id);
  }
  expect(carried.map((c) => c.description).sort()).toEqual(['Ongoing task', 'Open task']);

  // The originals are untouched and the carry is audited.
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM task WHERE record_id = $1', [prev.record.record_id]);
  expect(rows[0].n).toBe(3);
  const audit = await pool.query(`SELECT 1 FROM audit_log WHERE action = 'carry_forward'`);
  expect(audit.rowCount).toBe(2);
});

test('resolved tasks are not carried', async () => {
  await insertRecordWithStatus(world, { status: 'submitted', tasks: [PREVIOUS_TASKS[2]] });
  const submitted = await submitNew();
  expect(submitted.carried_forward).toBe(0);
  expect(submitted.tasks.every((t) => !t.carried_from_task_id)).toBe(true);
});

test('tasks on a closed previous record are not carried', async () => {
  await insertRecordWithStatus(world, { status: 'closed', tasks: PREVIOUS_TASKS });
  const submitted = await submitNew();
  expect(submitted.carried_forward).toBe(0);
});

test("other departments' tasks are never carried", async () => {
  await insertRecordWithStatus(world, { dept: 'dept_b', status: 'acknowledged', tasks: PREVIOUS_TASKS });
  const submitted = await submitNew();
  expect(submitted.carried_forward).toBe(0);
});

test('a task is carried forward at most once', async () => {
  const prev = await insertRecordWithStatus(world, { status: 'acknowledged', tasks: [PREVIOUS_TASKS[0]] });
  await submitNew();
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM task WHERE carried_from_task_id = $1', [prev.tasks[0].task_id],
  );
  expect(rows[0].n).toBe(1);
});

// GET /api/handovers/:id/export (FR-20): full record with tasks, incidents,
// acknowledgement, reviews and audit entries, under the same access rules as GET.
const request = require('supertest');
const {
  pool, app, buildWorld, as, tokenFor, createCompleteDraft,
} = require('./helpers/fixtures');

let world;
let record;

// Draft with a task and an incident -> submitted -> acknowledged -> under
// review -> escalated, so every section of the export has content.
beforeEach(async () => {
  world = await buildWorld();
  record = await createCompleteDraft(world);
  const url = (s) => `/api/handovers/${record.record_id}/${s}`;
  await as(world, 'outA').post(url('incidents'), {
    title: 'Fuel spill on stand 3', severity: 'medium', occurred_at: new Date().toISOString(),
  });
  await as(world, 'outA').post(url('submit'));
  await as(world, 'incA').post(url('acknowledgement'), { comments: 'Received' });
  await as(world, 'supA').post(url('open-review'));
  await as(world, 'supA').post(url('review'), { decision: 'escalated', comments: 'Spill needs a report' });
});
afterAll(() => pool.end());

const exportUrl = () => `/api/handovers/${record.record_id}/export`;

test('returns the record with tasks, incidents, acknowledgement, reviews and audit entries', async () => {
  const res = await as(world, 'supA').get(exportUrl());
  expect(res.status).toBe(200);
  const { body } = res;

  expect(body).toMatchObject({ format: 'shms.handover_record.v1', exported_by: world.users.supA.user_id });
  expect(new Date(body.exported_at).toString()).not.toBe('Invalid Date');
  expect(body.record).toMatchObject({ record_id: record.record_id, status: 'escalated' });
  expect(body.record.tasks.map((t) => t.description)).toEqual(['Check GPU on stand 5']);
  expect(body.record.incidents.map((i) => i.title)).toEqual(['Fuel spill on stand 3']);
  expect(body.record.acknowledgement).toMatchObject({ incoming_user_id: world.users.incA.user_id, comments: 'Received' });
  expect(body.record.reviews).toEqual([expect.objectContaining({ decision: 'escalated', supervisor_name: 'Test supA' })]);

  const actions = body.audit_log.map((a) => `${a.entity_type}:${a.action}`);
  expect(actions).toEqual(expect.arrayContaining([
    'handover_record:create', 'task:create', 'incident:create', 'handover_record:submit',
    'acknowledgement:create', 'handover_record:acknowledge', 'handover_record:open_review',
    'supervisor_review:create', 'handover_record:review',
  ]));
  expect(body.audit_log.every((a) => a.user_name)).toBe(true);
  const ids = body.audit_log.map((a) => Number(a.log_id));
  expect(ids).toEqual([...ids].sort((x, y) => x - y));
});

test('does not include audit entries for other records', async () => {
  const other = await as(world, 'outB').post('/api/handovers', { summary_notes: 'Other department draft' });
  expect(other.status).toBe(201);
  const { body } = await as(world, 'admin').get(exportUrl());
  expect(body.audit_log.some((a) => a.entity_id === other.body.record_id)).toBe(false);
});

test.each([
  ['outA', 200], ['incA', 200], ['supA', 200], ['admin', 200],
  ['outB', 403], ['incB', 403], ['supB', 403],
])('%s gets %i, the same as GET /:id', async (who, status) => {
  const exported = await as(world, who).get(exportUrl());
  const viewed = await as(world, who).get(`/api/handovers/${record.record_id}`);
  expect(exported.status).toBe(status);
  expect(viewed.status).toBe(status);
});

test('another outgoing user in the same department is refused, as with GET', async () => {
  const { rows: [u] } = await pool.query(
    `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
     VALUES ('T103', 'Test other', 'other@test.example', 'x', 'outgoing_staff', $1) RETURNING *`,
    [world.depts.dept_a.department_id],
  );
  const res = await request(app).get(exportUrl()).set('Authorization', `Bearer ${tokenFor(u)}`);
  expect(res.status).toBe(403);
});

test('requires authentication; 404 for unknown ids, 400 for bad ids', async () => {
  expect((await request(app).get(exportUrl())).status).toBe(401);
  expect((await as(world, 'admin').get('/api/handovers/00000000-0000-4000-8000-000000000000/export')).status).toBe(404);
  expect((await as(world, 'admin').get('/api/handovers/nope/export')).status).toBe(400);
});

test('?download=1 sends it as a JSON attachment', async () => {
  const res = await as(world, 'supA').get(`${exportUrl()}?download=1`);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toMatch(/application\/json/);
  expect(res.headers['content-disposition']).toBe(`attachment; filename="handover-${record.record_id}.json"`);
});

// POST /api/handovers/:id/open-review: acknowledged -> under_review, by a
// supervisor of the record's department or an admin; audited with who and when.
const {
  pool, buildWorld, as, submitCompleteRecord, getRecordRow,
} = require('./helpers/fixtures');

let world;
let record;
beforeEach(async () => {
  world = await buildWorld();
  record = await submitCompleteRecord(world);
});
afterAll(() => pool.end());

const url = (suffix) => `/api/handovers/${record.record_id}/${suffix}`;
const acknowledge = () => as(world, 'incA').post(url('acknowledgement'), {});

test('supervisor opens review on an acknowledged record', async () => {
  await acknowledge();
  const res = await as(world, 'supA').post(url('open-review'));
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('under_review');
  expect((await getRecordRow(record.record_id)).status).toBe('under_review');
});

test('the audit log records who opened the review and when', async () => {
  await acknowledge();
  const before = Date.now();
  await as(world, 'supA').post(url('open-review'));

  const { rows } = await pool.query(
    `SELECT user_id, previous_value, new_value, logged_at FROM audit_log
      WHERE entity_type = 'handover_record' AND entity_id = $1 AND action = 'open_review'`,
    [record.record_id],
  );
  expect(rows).toHaveLength(1);
  const [entry] = rows;
  expect(entry.user_id).toBe(world.users.supA.user_id);
  expect(entry.previous_value.status).toBe('acknowledged');
  expect(entry.new_value).toMatchObject({ status: 'under_review', opened_by: world.users.supA.user_id });
  expect(new Date(entry.new_value.opened_at).getTime()).toBeGreaterThanOrEqual(before - 5000);

  const detail = await as(world, 'supA').get(`/api/handovers/${record.record_id}`);
  expect(detail.body.thread.map((t) => t.action)).toContain('open_review');
});

test('admin may open review in any department', async () => {
  await acknowledge();
  const res = await as(world, 'admin').post(url('open-review'));
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('under_review');
});

test.each([
  ['submitted', async () => {}],
  ['queried', async () => as(world, 'incA').post(url('query'), { comments: 'Which stand?' })],
  ['under_review', async () => { await acknowledge(); await as(world, 'supA').post(url('open-review')); }],
  ['closed', async () => { await acknowledge(); await as(world, 'supA').post(url('review'), { decision: 'approved' }); }],
  ['escalated', async () => { await acknowledge(); await as(world, 'supA').post(url('review'), { decision: 'escalated' }); }],
])('returns 409 when the record is %s', async (status, setup) => {
  await setup();
  expect((await getRecordRow(record.record_id)).status).toBe(status);
  const res = await as(world, 'supA').post(url('open-review'));
  expect(res.status).toBe(409);
  expect((await getRecordRow(record.record_id)).status).toBe(status);
});

test('a supervisor from another department is refused (403)', async () => {
  await acknowledge();
  const res = await as(world, 'supB').post(url('open-review'));
  expect(res.status).toBe(403);
  expect((await getRecordRow(record.record_id)).status).toBe('acknowledged');
});

test.each(['outA', 'incA'])('%s may not open a review (403)', async (who) => {
  await acknowledge();
  expect((await as(world, who).post(url('open-review'))).status).toBe(403);
});

test('unknown record is 404, bad id is 400', async () => {
  expect((await as(world, 'supA').post('/api/handovers/00000000-0000-4000-8000-000000000000/open-review')).status).toBe(404);
  expect((await as(world, 'supA').post('/api/handovers/not-a-uuid/open-review')).status).toBe(400);
});

test.each(['approved', 'escalated'])('an under-review record can be %s by the supervisor', async (decision) => {
  await acknowledge();
  await as(world, 'supA').post(url('open-review'));
  const res = await as(world, 'supA').post(url('review'), { decision });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe(decision === 'approved' ? 'closed' : 'escalated');
});

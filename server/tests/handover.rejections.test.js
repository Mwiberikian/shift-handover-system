// DR-12: validation happens at the API before anything is written, and every
// rejected submission is logged with the reason: an audit_log row
// 'submit_rejected' written after the rollback, plus one log line.
const logger = require('../src/utils/logger');
const {
  pool, buildWorld, as,
} = require('./helpers/fixtures');

let world;
let warn;
beforeEach(async () => {
  world = await buildWorld();
  warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
afterAll(() => pool.end());

const rejections = async () => (await pool.query(
  `SELECT user_id, entity_type, entity_id, action, new_value FROM audit_log
    WHERE action = 'submit_rejected' ORDER BY log_id`,
)).rows;

test('a 422 submit is rolled back, then audited with the missing fields and logged once', async () => {
  const { body: draft } = await as(world, 'outA').post('/api/handovers', {});
  const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
  expect(res.status).toBe(422);

  const { rows: [record] } = await pool.query('SELECT status FROM handover_record WHERE record_id = $1', [draft.record_id]);
  expect(record.status).toBe('draft');
  const submits = await pool.query("SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'submit'", [draft.record_id]);
  expect(submits.rowCount).toBe(0);

  const rows = await rejections();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    user_id: world.users.outA.user_id, entity_type: 'handover_record', entity_id: draft.record_id, action: 'submit_rejected',
  });
  expect(rows[0].new_value).toMatchObject({
    operation: 'POST /api/handovers/:id/submit', record_id: draft.record_id, status: 422,
  });
  expect(rows[0].new_value.details.missing_fields.map((m) => m.field))
    .toEqual(['incoming_user_id', 'summary_notes', 'tasks']);

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0][0]).toMatch(/^\[rejected\] 422 POST \/api\/handovers\/:id\/submit user=\S+ record=\S+ reason=".+" fields=incoming_user_id,summary_notes,tasks$/);
});

test('a 400 on a record write is audited with the failing fields, never the submitted text', async () => {
  const { body: draft } = await as(world, 'outA').post('/api/handovers', {});
  const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/tasks`, { description: 'too short' });
  expect(res.status).toBe(400);

  const [row] = await rejections();
  expect(row).toMatchObject({ entity_type: 'handover_record', entity_id: draft.record_id });
  expect(row.new_value).toMatchObject({
    operation: 'POST /api/handovers/:id/tasks',
    status: 400,
    details: [{ field: 'description', message: 'description must be 10 to 1000 characters' }],
  });
  expect(JSON.stringify(row.new_value)).not.toContain('too short');
  const tasks = await pool.query('SELECT 1 FROM task WHERE record_id = $1', [draft.record_id]);
  expect(tasks.rowCount).toBe(0);
  expect(warn).toHaveBeenCalledTimes(1);
});

test('a rejected create (no record yet) is filed against the user', async () => {
  const res = await as(world, 'outA').post('/api/handovers', { incoming_user_id: 'not-a-uuid' });
  expect(res.status).toBe(400);
  const [row] = await rejections();
  expect(row).toMatchObject({ entity_type: 'app_user', entity_id: world.users.outA.user_id });
  expect(row.new_value).toMatchObject({ operation: 'POST /api/handovers/', record_id: null });
});

test('reads, permission refusals and successful writes are not logged as rejections', async () => {
  await as(world, 'outA').get('/api/handovers?status=bogus'); // 400 on a read
  await as(world, 'incA').post('/api/handovers', {}); // 403
  await as(world, 'outA').post('/api/handovers', {}); // 201
  expect(await rejections()).toHaveLength(0);
  expect(warn).not.toHaveBeenCalled();
});

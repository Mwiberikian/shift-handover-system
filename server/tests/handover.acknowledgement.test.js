// A record can only reach 'closed' after the incoming staff member has
// acknowledged it (API and DB both enforce this).
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

test('supervisor review of an unacknowledged record is rejected (409)', async () => {
  const res = await as(world, 'supA').post(url('review'), { decision: 'approved' });
  expect(res.status).toBe(409);
  expect(res.body.error).toMatch(/requires status 'acknowledged'/);
  expect((await getRecordRow(record.record_id)).status).toBe('submitted');
});

test('the DB refuses to close a record that was never acknowledged', async () => {
  await expect(pool.query(`UPDATE handover_record SET status = 'closed' WHERE record_id = $1`, [record.record_id]))
    .rejects.toThrow(/illegal status transition submitted -> closed/);
});

test('a queried record cannot be reviewed until clarified and acknowledged', async () => {
  expect((await as(world, 'incA').post(url('query'), { comments: 'Which stand?' })).status).toBe(200);
  expect((await as(world, 'supA').post(url('review'), { decision: 'approved' })).status).toBe(409);
  expect((await as(world, 'incA').post(url('acknowledgement'), {})).status).toBe(409); // must be clarified first

  expect((await as(world, 'outA').post(url('clarify'), { comments: 'Stand 5' })).body.status).toBe('submitted');
  expect((await as(world, 'incA').post(url('acknowledgement'), {})).body.status).toBe('acknowledged');
  const closed = await as(world, 'supA').post(url('review'), { decision: 'approved' });
  expect(closed.body.status).toBe('closed');
  expect(closed.body.closed_at).toBeTruthy();
});

test('acknowledge -> approve closes the record and records who did what', async () => {
  const ack = await as(world, 'incA').post(url('acknowledgement'), { comments: 'Received' });
  expect(ack.status).toBe(200);
  expect(ack.body.acknowledgement).toMatchObject({ incoming_user_id: world.users.incA.user_id, query_raised: false });
  expect(ack.body.acknowledgement.confirmed_at).toBeTruthy();

  const { rows: notes } = await pool.query(
    `SELECT recipient_id FROM notification WHERE record_id = $1 AND type = 'handover_acknowledged'`, [record.record_id],
  );
  expect(notes.map((n) => n.recipient_id)).toEqual([world.users.outA.user_id]);

  const rev = await as(world, 'supA').post(url('review'), { decision: 'approved', comments: 'OK' });
  expect(rev.body.status).toBe('closed');
  const { rows: reviews } = await pool.query('SELECT decision, supervisor_id FROM supervisor_review WHERE record_id = $1', [record.record_id]);
  expect(reviews).toEqual([{ decision: 'approved', supervisor_id: world.users.supA.user_id }]);
});

test('escalated records close only through /resolve', async () => {
  await as(world, 'incA').post(url('acknowledgement'), {});
  expect((await as(world, 'supA').post(url('review'), { decision: 'escalated' })).body.status).toBe('escalated');
  expect((await as(world, 'supA').post(url('review'), { decision: 'approved' })).status).toBe(409);
  const resolved = await as(world, 'supA').post(url('resolve'), { comments: 'Handled' });
  expect(resolved.body.status).toBe('closed');
});

test('/resolve on a non-escalated record is rejected (409)', async () => {
  await as(world, 'incA').post(url('acknowledgement'), {});
  expect((await as(world, 'supA').post(url('resolve'), {})).status).toBe(409);
});

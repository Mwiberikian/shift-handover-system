// GET /api/notifications/unread-count: the endpoint the client polls every 5 s
// (NFR-03). Counts only the caller's unread notifications.
const request = require('supertest');
const {
  pool, app, buildWorld, as, submitCompleteRecord,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const unread = async (who) => {
  const res = await as(world, who).get('/api/notifications/unread-count');
  expect(res.status).toBe(200);
  return res.body;
};

test('requires authentication', async () => {
  expect((await request(app).get('/api/notifications/unread-count')).status).toBe(401);
});

test('is zero with no notifications', async () => {
  expect(await unread('incA')).toEqual({ count: 0, latest_id: null });
});

test('a submit raises the count for the incoming user and supervisor only', async () => {
  const record = await submitCompleteRecord(world);
  const inc = await unread('incA');
  const { rows: [n] } = await pool.query(
    `SELECT notification_id FROM notification WHERE recipient_id = $1 AND record_id = $2`,
    [world.users.incA.user_id, record.record_id],
  );
  expect(inc).toEqual({ count: 1, latest_id: n.notification_id });
  expect((await unread('supA')).count).toBe(1);
  expect((await unread('outA')).count).toBe(0);
  expect((await unread('supB')).count).toBe(0);
  expect((await unread('incB')).count).toBe(0);
});

test('reading a notification lowers the count but keeps latest_id', async () => {
  await submitCompleteRecord(world);
  const before = await unread('incA');
  await as(world, 'incA').post(`/api/notifications/${before.latest_id}/read`);
  expect(await unread('incA')).toEqual({ count: 0, latest_id: before.latest_id });
});

test('latest_id changes when a new notification arrives', async () => {
  const record = await submitCompleteRecord(world);
  const first = await unread('incA');
  await as(world, 'incA').post(`/api/notifications/${first.latest_id}/read`);

  await as(world, 'incA').post(`/api/handovers/${record.record_id}/query`, { comments: 'Which stand?' });
  await as(world, 'outA').post(`/api/handovers/${record.record_id}/clarify`, { comments: 'Stand 5' });

  const next = await unread('incA');
  expect(next.count).toBe(1);
  expect(next.latest_id).not.toBe(first.latest_id);
});

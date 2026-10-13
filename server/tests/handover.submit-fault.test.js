// NFR-10: every write of one submission commits in one ACID transaction, so
// a failure part-way through leaves no partial record.
//
// Fault injection: the pooled client used by withTransaction is wrapped so
// that one chosen statement throws, after earlier steps of the submit (carry
// forward, status change, audit) have already run inside the transaction.
const pool = require('../src/config/db');
const logger = require('../src/utils/logger');
const {
  buildWorld, as, createCompleteDraft, insertRecordWithStatus,
} = require('./helpers/fixtures');

let world;
let draft;
let previousTask;
let restore = [];
beforeEach(async () => {
  world = await buildWorld();
  // An acknowledged previous record with an open task, so submit carries it forward.
  ({ tasks: [previousTask] } = await insertRecordWithStatus(world, {
    shift: 'previous', status: 'acknowledged', tasks: [{ description: 'Unfinished from last shift', status: 'open' }],
  }));
  draft = await createCompleteDraft(world);
});
afterEach(() => { restore.forEach((fn) => fn()); restore = []; });
afterAll(() => pool.end());

// The next transaction whose SQL matches `pattern` throws there.
function failOn(pattern) {
  const realConnect = pool.connect.bind(pool);
  const spy = jest.spyOn(pool, 'connect').mockImplementation(async (callback) => {
    // pool.query() checks out clients with a callback; leave those alone.
    if (callback) return realConnect(callback);
    const client = await realConnect();
    const realQuery = client.query.bind(client);
    client.query = (sql, ...rest) => {
      const text = typeof sql === 'string' ? sql : sql.text;
      if (pattern.test(text)) return Promise.reject(new Error(`injected fault at: ${text.trim().split('\n')[0]}`));
      return realQuery(sql, ...rest);
    };
    // Put the real query back before the client goes back to the pool.
    const realRelease = client.release.bind(client);
    client.release = (...args) => { client.query = realQuery; client.release = realRelease; return realRelease(...args); };
    return client;
  });
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  restore.push(() => spy.mockRestore(), () => err.mockRestore());
}

async function assertUntouched() {
  const { rows: [rec] } = await pool.query('SELECT status, submitted_at FROM handover_record WHERE record_id = $1', [draft.record_id]);
  expect(rec).toEqual({ status: 'draft', submitted_at: null });

  const audit = await pool.query(
    `SELECT action FROM audit_log
      WHERE (entity_type = 'handover_record' AND entity_id = $1 AND action <> 'create')
         OR action IN ('carry_forward', 'submit', 'submit_rejected')`,
    [draft.record_id],
  );
  expect(audit.rows).toEqual([]);

  const notes = await pool.query('SELECT 1 FROM notification');
  expect(notes.rowCount).toBe(0);

  const carried = await pool.query('SELECT 1 FROM task WHERE carried_from_task_id = $1', [previousTask.task_id]);
  expect(carried.rowCount).toBe(0);
  const tasks = await pool.query('SELECT description FROM task WHERE record_id = $1', [draft.record_id]);
  expect(tasks.rows).toEqual([{ description: 'Check GPU on stand 5' }]);
}

test.each([
  ['the notification insert (last step)', /INSERT INTO notification/],
  ["the 'submit' audit row (after the status change)", /INSERT INTO audit_log/],
  ['the status change (after carry-forward)', /UPDATE handover_record SET status = 'submitted'/],
])('a failure at %s rolls everything back', async (_, pattern) => {
  failOn(pattern);
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
  restore.push(() => warn.mockRestore());

  const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'Internal server error' });
  await assertUntouched();
  expect(warn).not.toHaveBeenCalled(); // a 500 is not a validation rejection (DR-12)
});

test('the fault really was mid-way: without it the same submit carries forward, audits and notifies', async () => {
  const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
  expect(res.status).toBe(200);
  expect(res.body.carried_forward).toBe(1);
  const notes = await pool.query('SELECT 1 FROM notification WHERE record_id = $1', [draft.record_id]);
  expect(notes.rowCount).toBe(2);
});

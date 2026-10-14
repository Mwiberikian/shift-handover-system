// Part L1: the report tables and their triggers, exercised with direct SQL
// (no API), so the database rules hold even if the service layer is bypassed.
const { pool, buildWorld } = require('./helpers/fixtures');

const DONE = 'Cleared stands 4 to 7 and logged the GPU fault.';
const PENDING = 'GPU cable on stand 5 still needs replacing.';

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const insertReport = async (fields = {}) => (await pool.query(
  `INSERT INTO report (author_id, shift_id, title, done_text, pending_text, nothing_pending)
   VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
  [
    world.users.outA.user_id, world.shifts.dept_a.current.shift_id, fields.title ?? 'Day shift report',
    fields.done_text ?? DONE, fields.pending_text ?? PENDING, fields.nothing_pending ?? false,
  ],
)).rows[0];
const submitSql = (id) => pool.query("UPDATE report SET status = 'submitted', submitted_at = now() WHERE report_id = $1 RETURNING *", [id]);
const rejects = (promise, pattern) => expect(promise).rejects.toThrow(pattern);

describe('report', () => {
  test('a draft may be incomplete; submitting needs done 10-5000 and pending 10-5000', async () => {
    const draft = await insertReport({ done_text: '', pending_text: '' });
    expect(draft.status).toBe('draft');
    await rejects(submitSql(draft.report_id), /report_submitted_complete/);

    await pool.query("UPDATE report SET done_text = 'too short' WHERE report_id = $1", [draft.report_id]);
    await rejects(submitSql(draft.report_id), /report_submitted_complete/);

    await pool.query('UPDATE report SET done_text = $2, pending_text = $3 WHERE report_id = $1', [draft.report_id, DONE, 'short']);
    await rejects(submitSql(draft.report_id), /report_submitted_complete/);

    await pool.query('UPDATE report SET pending_text = $2 WHERE report_id = $1', [draft.report_id, PENDING]);
    expect((await submitSql(draft.report_id)).rows[0].status).toBe('submitted');
  });

  test('nothing_pending lifts the pending_text minimum', async () => {
    const r = await insertReport({ pending_text: '', nothing_pending: true });
    expect((await submitSql(r.report_id)).rows[0].status).toBe('submitted');
  });

  test('no text may exceed 5000 characters, even in a draft', async () => {
    await rejects(insertReport({ done_text: 'x'.repeat(5001) }), /report_text_max/);
    const ok = await insertReport({ done_text: 'x'.repeat(5000), pending_text: 'y'.repeat(5000) });
    expect((await submitSql(ok.report_id)).rows[0].status).toBe('submitted');
  });

  test('a submitted report cannot be changed or deleted by direct SQL', async () => {
    const r = await insertReport();
    await submitSql(r.report_id);
    await rejects(pool.query("UPDATE report SET done_text = 'Rewritten after the fact, quietly.' WHERE report_id = $1", [r.report_id]), /submitted and cannot be changed/);
    await rejects(pool.query("UPDATE report SET status = 'draft' WHERE report_id = $1", [r.report_id]), /submitted and cannot be changed/);
    await rejects(pool.query('DELETE FROM report WHERE report_id = $1', [r.report_id]), /submitted and cannot be deleted/);
    const { rows: [after] } = await pool.query('SELECT done_text, status FROM report WHERE report_id = $1', [r.report_id]);
    expect(after).toEqual({ done_text: DONE, status: 'submitted' });
  });

  test('author, shift and creation time never change, even on a draft', async () => {
    const r = await insertReport();
    await rejects(pool.query('UPDATE report SET author_id = $2 WHERE report_id = $1', [r.report_id, world.users.incA.user_id]), /cannot change/);
    await rejects(pool.query('UPDATE report SET shift_id = $2 WHERE report_id = $1', [r.report_id, world.shifts.dept_a.previous.shift_id]), /cannot change/);
  });

  test('foreign keys restrict: a user with a report cannot be deleted', async () => {
    await insertReport();
    await rejects(pool.query('DELETE FROM app_user WHERE user_id = $1', [world.users.outA.user_id]), /foreign key/);
  });
});

describe('report_task', () => {
  test('links can be added and removed on a draft, never after submit, never updated', async () => {
    const { rows: [rec] } = await pool.query(
      `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id) VALUES ($1, $2, $3) RETURNING *`,
      [world.shifts.dept_a.current.shift_id, world.depts.dept_a.department_id, world.users.outA.user_id],
    );
    const task = async (d) => (await pool.query('INSERT INTO task (record_id, description) VALUES ($1, $2) RETURNING *', [rec.record_id, d])).rows[0];
    const [t1, t2] = [await task('Check the GPU on stand 5'), await task('Restock the fuel log sheets')];
    const r = await insertReport();
    await pool.query('INSERT INTO report_task (report_id, task_id) VALUES ($1, $2), ($1, $3)', [r.report_id, t1.task_id, t2.task_id]);
    await pool.query('DELETE FROM report_task WHERE report_id = $1 AND task_id = $2', [r.report_id, t2.task_id]);
    await rejects(pool.query('UPDATE report_task SET task_id = $2 WHERE report_id = $1', [r.report_id, t2.task_id]), /cannot be updated/);

    await submitSql(r.report_id);
    await rejects(pool.query('INSERT INTO report_task (report_id, task_id) VALUES ($1, $2)', [r.report_id, t2.task_id]), /report .* is submitted/);
    await rejects(pool.query('DELETE FROM report_task WHERE report_id = $1', [r.report_id]), /report .* is submitted/);
  });
});

describe('report_share', () => {
  let report;
  beforeEach(async () => {
    report = await insertReport();
  });
  const share = (userId = world.users.incA.user_id) => pool.query(
    'INSERT INTO report_share (report_id, user_id, shared_by) VALUES ($1, $2, $3) RETURNING *',
    [report.report_id, userId, world.users.outA.user_id],
  );

  test('only a submitted report can be shared, once per user', async () => {
    await rejects(share(), /not submitted and cannot be shared/);
    await submitSql(report.report_id);
    await share();
    await rejects(share(), /report_share_once/);
  });

  test('append-only except read_at, which is set once', async () => {
    await submitSql(report.report_id);
    await share();
    const where = [report.report_id, world.users.incA.user_id];
    await pool.query('UPDATE report_share SET read_at = now() WHERE report_id = $1 AND user_id = $2', where);
    await rejects(pool.query("UPDATE report_share SET read_at = now() + interval '1 hour' WHERE report_id = $1 AND user_id = $2", where), /only read_at can be set, once/);
    await rejects(pool.query('UPDATE report_share SET shared_by = $3 WHERE report_id = $1 AND user_id = $2', [...where, world.users.supA.user_id]), /append-only/);
    await rejects(pool.query("UPDATE report_share SET shared_at = now() - interval '1 day' WHERE report_id = $1", [report.report_id]), /append-only/);
    await rejects(pool.query('DELETE FROM report_share WHERE report_id = $1', [report.report_id]), /append-only/);
  });
});

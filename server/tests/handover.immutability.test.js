// Core integrity guarantee: once a handover record leaves 'draft' it can never
// be edited or deleted — not via any API route and not via direct SQL.
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

describe('API layer: a submitted record is locked', () => {
  test('PATCH /api/handovers/:id is rejected with 409 and nothing changes', async () => {
    const before = await getRecordRow(record.record_id);
    const res = await as(world, 'outA').patch(`/api/handovers/${record.record_id}`, {
      summary_notes: 'Rewritten after the fact', incoming_user_id: null,
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/locked/);
    expect(await getRecordRow(record.record_id)).toEqual(before);
  });

  test('adding a task or incident is rejected with 409', async () => {
    const out = as(world, 'outA');
    const task = await out.post(`/api/handovers/${record.record_id}/tasks`, { description: 'late addition' });
    const incident = await out.post(`/api/handovers/${record.record_id}/incidents`, {
      title: 'late incident', severity: 'low', occurred_at: new Date().toISOString(),
    });
    expect(task.status).toBe(409);
    expect(incident.status).toBe(409);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM incident WHERE record_id = $1', [record.record_id]);
    expect(rows[0].n).toBe(0);
  });

  test('editing an existing task is rejected with 409', async () => {
    const taskId = record.tasks[0].task_id;
    const res = await as(world, 'outA').patch(`/api/handovers/${record.record_id}/tasks/${taskId}`, { status: 'resolved' });
    expect(res.status).toBe(409);
    const { rows: [t] } = await pool.query('SELECT status FROM task WHERE task_id = $1', [taskId]);
    expect(t.status).toBe('open');
  });

  test('re-submitting is rejected with 409', async () => {
    const res = await as(world, 'outA').post(`/api/handovers/${record.record_id}/submit`);
    expect(res.status).toBe(409);
  });

  test('the record stays locked in every later status (acknowledged, closed)', async () => {
    await as(world, 'incA').post(`/api/handovers/${record.record_id}/acknowledgement`, {});
    let res = await as(world, 'outA').patch(`/api/handovers/${record.record_id}`, { summary_notes: 'x'.repeat(30) });
    expect(res.status).toBe(409);

    await as(world, 'supA').post(`/api/handovers/${record.record_id}/review`, { decision: 'approved' });
    res = await as(world, 'outA').patch(`/api/handovers/${record.record_id}`, { summary_notes: 'x'.repeat(30) });
    expect(res.status).toBe(409);
    expect((await getRecordRow(record.record_id)).summary_notes).toBe(record.summary_notes);
  });

  test('there is no route that deletes a handover record', async () => {
    const res = await as(world, 'admin').delete(`/api/handovers/${record.record_id}`);
    expect(res.status).toBe(404);
    expect(await getRecordRow(record.record_id)).toBeDefined();
  });
});

describe('DB layer: triggers block tampering even if the API is bypassed', () => {
  test('UPDATE of content columns raises', async () => {
    await expect(pool.query(
      `UPDATE handover_record SET summary_notes = 'tampered' WHERE record_id = $1`, [record.record_id],
    )).rejects.toThrow(/locked/);
  });

  test('DELETE raises', async () => {
    await expect(pool.query('DELETE FROM handover_record WHERE record_id = $1', [record.record_id]))
      .rejects.toThrow(/cannot be deleted/);
  });

  test('INSERT/UPDATE/DELETE on child tasks raises', async () => {
    await expect(pool.query(`INSERT INTO task (record_id, description) VALUES ($1, 'x')`, [record.record_id]))
      .rejects.toThrow(/rejected/);
    await expect(pool.query(`UPDATE task SET description = 'x' WHERE record_id = $1`, [record.record_id]))
      .rejects.toThrow(/rejected/);
    await expect(pool.query('DELETE FROM task WHERE record_id = $1', [record.record_id]))
      .rejects.toThrow(/rejected/);
  });

  test('audit_log is append-only', async () => {
    await expect(pool.query(`UPDATE audit_log SET action = 'x'`)).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });

  test('a draft record is still editable (the lock is status-driven)', async () => {
    const { rows: [draft] } = await pool.query(
      `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id)
       VALUES ($1, $2, $3) RETURNING record_id`,
      [world.shifts.dept_b.current.shift_id, world.depts.dept_b.department_id, world.users.outB.user_id],
    );
    await expect(pool.query(`UPDATE handover_record SET summary_notes = 'ok' WHERE record_id = $1`, [draft.record_id]))
      .resolves.toBeDefined();
  });
});

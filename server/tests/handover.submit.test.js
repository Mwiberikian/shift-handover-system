// Submission: server-side template validation, locking, audit, notifications.
const {
  pool, buildWorld, as, createCompleteDraft, getRecordRow,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const fieldsOf = (res) => res.body.details.missing_fields.map((f) => f.field);

describe('POST /api/handovers/:id/submit — mandatory template fields', () => {
  test('an empty draft is rejected with 422 listing each missing field', async () => {
    const { body: draft } = await as(world, 'outA').post('/api/handovers', {});
    const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);

    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['incoming_user_id', 'summary_notes', 'tasks']);
    expect(res.body.error).toMatch(/incoming_user_id, summary_notes, tasks/);
    expect((await getRecordRow(draft.record_id)).status).toBe('draft');
  });

  test('a summary shorter than the template minLength is reported with the reason', async () => {
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').patch(`/api/handovers/${draft.record_id}`, { summary_notes: 'too short' });
    const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);

    expect(res.status).toBe(422);
    expect(res.body.details.missing_fields).toEqual([
      expect.objectContaining({ field: 'summary_notes', reason: expect.stringMatching(/at least 20 characters/) }),
    ]);
  });

  test('a rejected submit writes no audit row and no notifications', async () => {
    const { body: draft } = await as(world, 'outA').post('/api/handovers', {});
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
    const audit = await pool.query(`SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'submit'`, [draft.record_id]);
    const notes = await pool.query('SELECT 1 FROM notification WHERE record_id = $1', [draft.record_id]);
    expect(audit.rowCount).toBe(0);
    expect(notes.rowCount).toBe(0);
  });

  test('validation follows the current template version', async () => {
    const draft = await createCompleteDraft(world);
    const def = structuredClone((await as(world, 'admin').get('/api/admin/templates/dept_a')).body.template.field_definition);
    def.fields.find((f) => f.key === 'incidents').required = true;
    expect((await as(world, 'admin').put('/api/admin/templates/dept_a', { field_definition: def })).status).toBe(201);

    const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
    expect(res.status).toBe(422);
    expect(fieldsOf(res)).toEqual(['incidents']);
    expect(res.body.details.template_version).toBe(2);
  });
});

describe('POST /api/handovers/:id/submit — success', () => {
  test('sets status submitted, audits, and notifies incoming staff + supervisor', async () => {
    const draft = await createCompleteDraft(world);
    const res = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('submitted');
    expect(res.body.submitted_at).toBeTruthy();

    const { rows: notes } = await pool.query(
      'SELECT recipient_id, type FROM notification WHERE record_id = $1 ORDER BY recipient_id',
      [draft.record_id],
    );
    expect(notes.map((n) => n.recipient_id).sort())
      .toEqual([world.users.incA.user_id, world.users.supA.user_id].sort());
    expect(notes.every((n) => n.type === 'handover_submitted')).toBe(true);

    const { rows: [audit] } = await pool.query(
      `SELECT * FROM audit_log WHERE entity_id = $1 AND action = 'submit'`, [draft.record_id],
    );
    expect(audit.user_id).toBe(world.users.outA.user_id);
    expect(audit.previous_value.status).toBe('draft');
    expect(audit.new_value).toMatchObject({ status: 'submitted', template_version: 1 });
  });

  test('every state-changing call leaves a matching audit_log row', async () => {
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/submit`);
    const { rows } = await pool.query(
      `SELECT entity_type, action FROM audit_log WHERE action <> 'login' ORDER BY log_id`,
    );
    expect(rows).toEqual([
      { entity_type: 'handover_record', action: 'create' },
      { entity_type: 'task', action: 'create' },
      { entity_type: 'handover_record', action: 'submit' },
    ]);
  });
});

// Role- and department-based access control: out-of-scope requests get an
// explicit 401/403, never a silently filtered result.
const {
  pool, app, buildWorld, as, createCompleteDraft, submitCompleteRecord, tokenFor,
} = require('./helpers/fixtures');
const request = require('supertest');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

describe('incoming staff cannot use outgoing-only routes', () => {
  test('create, edit, add task/incident, submit, clarify are all 403', async () => {
    const draft = await createCompleteDraft(world);
    const inc = as(world, 'incA');
    const id = draft.record_id;
    const responses = await Promise.all([
      inc.post('/api/handovers', {}),
      inc.patch(`/api/handovers/${id}`, { summary_notes: 'hijack attempt by incoming' }),
      inc.post(`/api/handovers/${id}/tasks`, { description: 'x' }),
      inc.post(`/api/handovers/${id}/incidents`, { title: 'x', severity: 'low', occurred_at: new Date().toISOString() }),
      inc.post(`/api/handovers/${id}/submit`),
      inc.post(`/api/handovers/${id}/clarify`, { comments: 'x' }),
    ]);
    responses.forEach((r) => expect(r.status).toBe(403));
  });
});

describe('outgoing staff cannot use incoming/supervisor routes', () => {
  test('acknowledge, query, review, resolve are all 403', async () => {
    const record = await submitCompleteRecord(world);
    const out = as(world, 'outA');
    const id = record.record_id;
    const responses = await Promise.all([
      out.post(`/api/handovers/${id}/acknowledgement`, {}),
      out.post(`/api/handovers/${id}/query`, { comments: 'x' }),
      out.post(`/api/handovers/${id}/review`, { decision: 'approved' }),
      out.post(`/api/handovers/${id}/resolve`, {}),
    ]);
    responses.forEach((r) => expect(r.status).toBe(403));
    const { rows: [r] } = await pool.query('SELECT status FROM handover_record WHERE record_id = $1', [id]);
    expect(r.status).toBe('submitted');
  });
});

describe('department and assignment scoping', () => {
  test("another department's outgoing staff cannot edit the record (403)", async () => {
    const draft = await createCompleteDraft(world);
    const res = await as(world, 'outB').patch(`/api/handovers/${draft.record_id}`, { summary_notes: 'cross-department edit' });
    expect(res.status).toBe(403);
  });

  test("another department's supervisor cannot review (403)", async () => {
    const record = await submitCompleteRecord(world);
    await as(world, 'incA').post(`/api/handovers/${record.record_id}/acknowledgement`, {});
    const res = await as(world, 'supB').post(`/api/handovers/${record.record_id}/review`, { decision: 'approved' });
    expect(res.status).toBe(403);
  });

  test('an incoming user cannot view a record not assigned to them (403)', async () => {
    const record = await submitCompleteRecord(world);
    expect((await as(world, 'incB').get(`/api/handovers/${record.record_id}`)).status).toBe(403);
    expect((await as(world, 'incA').get(`/api/handovers/${record.record_id}`)).status).toBe(200);
  });

  test('filtering a list by another department is 403, not an empty list', async () => {
    const res = await as(world, 'supA').get(`/api/handovers?department_id=${world.depts.dept_b.department_id}`);
    expect(res.status).toBe(403);
  });

  test('supervisor dashboard for another department is 403', async () => {
    const res = await as(world, 'supA').get('/api/dashboard/supervisor?department_code=dept_b');
    expect(res.status).toBe(403);
  });

  test('non-admins cannot reach admin routes', async () => {
    for (const who of ['outA', 'incA', 'supA']) {
      expect((await as(world, who).get('/api/admin/users')).status).toBe(403);
    }
    expect((await as(world, 'admin').get('/api/admin/users')).status).toBe(200);
  });
});

describe('authentication', () => {
  test('missing or invalid token is 401', async () => {
    expect((await request(app).get('/api/handovers')).status).toBe(401);
    expect((await request(app).get('/api/handovers').set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  test('a token for a deactivated account is rejected immediately', async () => {
    const token = tokenFor(world.users.outA);
    await as(world, 'admin').delete(`/api/admin/users/${world.users.outA.user_id}`);
    const res = await request(app).get('/api/handovers').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });
});

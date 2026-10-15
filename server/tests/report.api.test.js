// Part L2: the shift report API - prefilled drafts, author-only edits, submit
// with the missing fields, the list scopes and filters, reads, and sharing.
const { pool, buildWorld, as, createCompleteDraft } = require('./helpers/fixtures');
const { formatEAT } = require('../src/utils/eat');

const DONE = 'Checked GPU on stand 5 and cleared the backlog.';
const PENDING = 'Fuel truck 3 still waiting for a part.';

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const assign = (who, shift = world.shifts[world.users[who].department_id === world.depts.dept_b.department_id ? 'dept_b' : 'dept_a'].current) => pool.query(
  'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [shift.shift_id, world.users[who].user_id],
);
const auditActions = async (id) => (await pool.query(
  "SELECT action FROM audit_log WHERE entity_type = 'report' AND entity_id = $1 ORDER BY log_id", [id],
)).rows.map((r) => r.action);

// A draft written by `who` on their department's current shift.
async function draft(who) {
  await assign(who);
  const res = await as(world, who).post('/api/reports');
  if (res.status !== 201) throw new Error(`draft: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

async function submitted(who, extra = {}) {
  const d = await draft(who);
  await as(world, who).patch(`/api/reports/${d.report_id}`, { done_text: DONE, pending_text: PENDING, nothing_pending: false, ...extra });
  const res = await as(world, who).post(`/api/reports/${d.report_id}/submit`);
  if (res.status !== 200) throw new Error(`submit: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

describe('POST /api/reports (prefilled draft)', () => {
  test('without a current shift or session it is a 409 with a clear message', async () => {
    const res = await as(world, 'outA').post('/api/reports');
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe('no_current_shift');
  });

  test('prefills from the work session: tasks resolved during it as done, open and in-progress tasks as pending', async () => {
    await assign('outA');
    await as(world, 'outA').post('/api/sessions/start');
    const record = await createCompleteDraft(world); // adds an open high-priority task
    const out = as(world, 'outA');
    const { body: fixed } = await out.post(`/api/handovers/${record.record_id}/tasks`, { description: 'Replace tyre on tug 12' });
    await out.patch(`/api/handovers/${record.record_id}/tasks/${fixed.task_id}`, { status: 'resolved' });
    const { body: wip } = await out.post(`/api/handovers/${record.record_id}/tasks`, { description: 'Reconcile the baggage count', status: 'in_progress' });

    const res = await out.post('/api/reports');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      created: true, status: 'draft', access: 'author', nothing_pending: false,
      shift_id: world.shifts.dept_a.current.shift_id,
      title: `Current shift report ${formatEAT(world.shifts.dept_a.current.start_time, 'date')}`,
      done_text: '- Replace tyre on tug 12',
    });
    expect(res.body.pending_text.split('\n').sort()).toEqual(['- Check GPU on stand 5', '- Reconcile the baggage count (in progress)']);
    expect(res.body.tasks.map((t) => t.task_id).sort()).toEqual(
      [fixed.task_id, wip.task_id, (await pool.query("SELECT task_id FROM task WHERE description = 'Check GPU on stand 5'")).rows[0].task_id].sort(),
    );
    expect(await auditActions(res.body.report_id)).toEqual(['create']);
  });

  test('with nothing to prefill, "nothing pending" starts ticked; a second call reopens the same draft', async () => {
    const first = await draft('incA');
    expect(first).toMatchObject({ done_text: '', pending_text: '', nothing_pending: true, tasks: [] });
    const again = await as(world, 'incA').post('/api/reports');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ created: false, report_id: first.report_id });
  });
});

describe('PATCH /api/reports/:id', () => {
  test('the author edits a draft (audited); anyone else gets 403', async () => {
    const d = await draft('outA');
    const res = await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { title: 'Night summary', done_text: DONE, nothing_pending: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'Night summary', done_text: DONE, nothing_pending: true });
    for (const who of ['incA', 'supA', 'admin']) {
      expect((await as(world, who).patch(`/api/reports/${d.report_id}`, { title: 'x' })).status).toBe(403);
    }
    expect(await auditActions(d.report_id)).toEqual(['create', 'update']);
  });

  test('refuses text over the limits and bad types (400)', async () => {
    const d = await draft('outA');
    const out = as(world, 'outA');
    expect((await out.patch(`/api/reports/${d.report_id}`, { done_text: 'x'.repeat(5001) })).status).toBe(400);
    expect((await out.patch(`/api/reports/${d.report_id}`, { title: 'x'.repeat(161) })).status).toBe(400);
    expect((await out.patch(`/api/reports/${d.report_id}`, { nothing_pending: 'yes' })).status).toBe(400);
    expect((await out.patch(`/api/reports/${d.report_id}`, { task_ids: ['not-a-uuid'] })).status).toBe(400);
    expect((await out.patch(`/api/reports/${d.report_id}`, { done_text: 'x'.repeat(5000) })).status).toBe(200);
  });

  test('links only tasks from the author\'s department', async () => {
    const d = await draft('outA');
    const own = await createCompleteDraft(world);
    const { rows: [ownTask] } = await pool.query('SELECT task_id FROM task WHERE record_id = $1', [own.record_id]);
    const { body: other } = await as(world, 'outB').post('/api/handovers', { summary_notes: 'Department B summary for the shift.' });
    const { body: otherTask } = await as(world, 'outB').post(`/api/handovers/${other.record_id}/tasks`, { description: 'Department B task to do' });

    const bad = await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { task_ids: [ownTask.task_id, otherTask.task_id] });
    expect(bad.status).toBe(400);
    const ok = await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { task_ids: [ownTask.task_id] });
    expect(ok.body.tasks.map((t) => t.task_id)).toEqual([ownTask.task_id]);
  });
});

describe('POST /api/reports/:id/submit', () => {
  test('422 lists the missing fields; nothing changes', async () => {
    const d = await draft('outA');
    await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { done_text: ' short \n\n\n\n\n', nothing_pending: false });
    const res = await as(world, 'outA').post(`/api/reports/${d.report_id}/submit`);
    expect(res.status).toBe(422);
    expect(res.body.details.missing_fields.map((m) => m.field)).toEqual(['done_text', 'pending_text']);
    expect((await pool.query('SELECT status FROM report WHERE report_id = $1', [d.report_id])).rows[0].status).toBe('draft');
  });

  test('submits (trimmed, audited); "nothing pending" waives the pending text; then it cannot change', async () => {
    const d = await draft('outA');
    await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { done_text: `\n  ${DONE}\n\n`, pending_text: '', nothing_pending: true });
    const res = await as(world, 'outA').post(`/api/reports/${d.report_id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'submitted', done_text: DONE });
    expect(res.body.submitted_at).toBeTruthy();
    expect(await auditActions(d.report_id)).toEqual(['create', 'update', 'submit']);

    expect((await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { title: 'Changed' })).status).toBe(409);
    expect((await as(world, 'outA').post(`/api/reports/${d.report_id}/submit`)).status).toBe(409);
  });

  test('only the author can submit', async () => {
    const d = await draft('outA');
    await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { done_text: DONE, nothing_pending: true });
    expect((await as(world, 'supA').post(`/api/reports/${d.report_id}/submit`)).status).toBe(403);
  });
});

describe('GET /api/reports (scopes and filters)', () => {
  test('mine, shared with me, department; list rows carry no report text', async () => {
    const a = await submitted('outA');
    const b = await submitted('outB');
    const aDraft = await draft('incA');
    await as(world, 'outA').post(`/api/reports/${a.report_id}/share`, { user_ids: [world.users.incA.user_id] });

    const mine = (await as(world, 'incA').get('/api/reports')).body;
    expect(mine.items.map((r) => r.report_id)).toEqual([aDraft.report_id]);
    const shared = (await as(world, 'incA').get('/api/reports?scope=shared')).body;
    expect(shared.items.map((r) => r.report_id)).toEqual([a.report_id]);
    expect(shared.items[0]).not.toHaveProperty('done_text');
    expect(shared.items[0]).not.toHaveProperty('pending_text');
    expect(shared.items[0].my_read_at).toBeNull();

    // Supervisors: their own department's submitted reports, never drafts.
    const supA = (await as(world, 'supA').get('/api/reports?scope=department')).body;
    expect(supA.items.map((r) => r.report_id)).toEqual([a.report_id]);
    expect((await as(world, 'supA').get(`/api/reports?scope=department&department_id=${world.depts.dept_b.department_id}`)).status).toBe(403);
    // Admin: every department, or one.
    const all = (await as(world, 'admin').get('/api/reports?scope=department')).body;
    expect(all.items.map((r) => r.report_id).sort()).toEqual([a.report_id, b.report_id].sort());
    const onlyB = (await as(world, 'admin').get(`/api/reports?scope=department&department_id=${world.depts.dept_b.department_id}`)).body;
    expect(onlyB.items.map((r) => r.report_id)).toEqual([b.report_id]);
    // Workers may not list a department.
    expect((await as(world, 'outA').get('/api/reports?scope=department')).status).toBe(403);
  });

  test('filters: date range, author, shift and status', async () => {
    const a = await submitted('outA');
    const inc = await submitted('incA');
    const sup = as(world, 'supA');
    const { start_time: start } = world.shifts.dept_a.current;
    const ids = async (qs) => (await sup.get(`/api/reports?scope=department&${qs}`)).body.items.map((r) => r.report_id).sort();

    expect(await ids(`author_id=${world.users.outA.user_id}`)).toEqual([a.report_id]);
    expect(await ids(`shift_id=${world.shifts.dept_a.current.shift_id}`)).toEqual([a.report_id, inc.report_id].sort());
    expect(await ids(`shift_id=${world.shifts.dept_a.previous.shift_id}`)).toEqual([]);
    expect(await ids(`from=${new Date(start).toISOString()}&to=${new Date(start).toISOString()}`)).toEqual([a.report_id, inc.report_id].sort());
    expect(await ids(`from=${new Date(new Date(start).getTime() + 1000).toISOString()}`)).toEqual([]);
    expect(await ids('status=draft')).toEqual([]);
    expect((await sup.get('/api/reports?status=closed')).status).toBe(400);
    expect((await sup.get('/api/reports?from=yesterday')).status).toBe(400);
    expect((await sup.get('/api/reports?scope=everything')).status).toBe(400);
  });

  test('page size is clamped to 100; a bad page is a 400', async () => {
    await draft('outA');
    const res = await as(world, 'outA').get('/api/reports?page_size=500');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, page_size: 100, total: 1 });
    expect((await as(world, 'outA').get('/api/reports?page=0')).status).toBe(400);
    expect((await as(world, 'outA').get('/api/reports?page_size=abc')).status).toBe(400);
  });
});

describe('GET /api/reports/:id', () => {
  test('a draft is the author\'s only; a submitted report is readable by recipients, the department\'s supervisor and admin', async () => {
    const d = await draft('outA');
    for (const who of ['incA', 'supA', 'admin']) expect((await as(world, who).get(`/api/reports/${d.report_id}`)).status).toBe(403);
    expect((await as(world, 'outA').get(`/api/reports/${d.report_id}`)).body.access).toBe('author');
  });

  test('every read is audited; a recipient\'s first read sets read_at once', async () => {
    const r = await submitted('outA');
    await as(world, 'outA').post(`/api/reports/${r.report_id}/share`, { user_ids: [world.users.incA.user_id] });
    const first = await as(world, 'incA').get(`/api/reports/${r.report_id}`);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ access: 'recipient', done_text: DONE, shares: [] });
    const readAt = (await pool.query('SELECT read_at FROM report_share WHERE report_id = $1', [r.report_id])).rows[0].read_at;
    expect(readAt).toBeTruthy();
    await as(world, 'incA').get(`/api/reports/${r.report_id}`);
    expect((await pool.query('SELECT read_at FROM report_share WHERE report_id = $1', [r.report_id])).rows[0].read_at).toEqual(readAt);

    expect((await as(world, 'supA').get(`/api/reports/${r.report_id}`)).body.access).toBe('supervisor');
    expect((await as(world, 'admin').get(`/api/reports/${r.report_id}`)).body.access).toBe('admin');
    expect((await as(world, 'supB').get(`/api/reports/${r.report_id}`)).status).toBe(403);
    expect((await as(world, 'outB').get(`/api/reports/${r.report_id}`)).status).toBe(403);
    expect(await auditActions(r.report_id)).toEqual(['create', 'update', 'submit', 'share', 'read', 'read', 'read', 'read']);
  });

  test('unknown id 404, malformed id 400', async () => {
    expect((await as(world, 'outA').get('/api/reports/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await as(world, 'outA').get('/api/reports/nope')).status).toBe(400);
  });
});

describe('POST /api/reports/:id/share', () => {
  test('a draft cannot be shared (409)', async () => {
    const d = await draft('outA');
    const res = await as(world, 'outA').post(`/api/reports/${d.report_id}/share`, { user_ids: [world.users.incA.user_id] });
    expect(res.status).toBe(409);
  });

  test('sharing notifies each new recipient in-app with the report linked, and is audited', async () => {
    const r = await submitted('outA');
    const res = await as(world, 'outA').post(`/api/reports/${r.report_id}/share`, { user_ids: [world.users.incA.user_id, world.users.supB.user_id] });
    expect(res.status).toBe(200);
    expect(res.body.shared.sort()).toEqual([world.users.incA.user_id, world.users.supB.user_id].sort());
    const { rows } = await pool.query("SELECT recipient_id, report_id, title FROM notification WHERE type = 'report_shared'");
    expect(rows).toHaveLength(2);
    for (const n of rows) {
      expect(n.report_id).toBe(r.report_id);
      expect(n.title).toBe(`Shift report shared with you: ${r.title}`);
    }
    // Sharing again with the same person adds nothing and notifies no one.
    const again = await as(world, 'outA').post(`/api/reports/${r.report_id}/share`, { user_ids: [world.users.incA.user_id] });
    expect(again.body).toMatchObject({ shared: [], already_shared: [world.users.incA.user_id] });
    expect((await pool.query("SELECT count(*)::int AS n FROM notification WHERE type = 'report_shared'")).rows[0].n).toBe(2);
  });

  test('share-candidates lists the people the caller may share with', async () => {
    const names = async (who) => (await as(world, who).get('/api/reports/share-candidates')).body.map((u) => u.full_name).sort();
    expect(await names('outA')).toEqual(['Test incA', 'Test supA', 'Test supB']);
    expect(await names('supA')).toEqual(['Test admin', 'Test incA', 'Test incB', 'Test outA', 'Test outB', 'Test supB']);
  });
});

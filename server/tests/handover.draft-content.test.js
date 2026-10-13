// FR-04: outgoing staff get their department's current template. FR-05: tasks
// carry a description, a status (open / in_progress / resolved) and a
// priority. FR-06: incidents carry a title, description, severity and time of
// occurrence.
const {
  pool, buildWorld, as, TEMPLATE,
} = require('./helpers/fixtures');

let world;
let record;
beforeEach(async () => {
  world = await buildWorld();
  ({ body: record } = await as(world, 'outA').post('/api/handovers', { summary_notes: null }));
});
afterAll(() => pool.end());

const fields = (res) => (res.body.details || []).map((d) => d.field);

describe('GET /api/handovers/meta (FR-04)', () => {
  test("returns the current shift, the department's current template and its own incoming staff only", async () => {
    const res = await as(world, 'outA').get('/api/handovers/meta');
    expect(res.status).toBe(200);
    expect(res.body.current_shift.shift_id).toBe(world.shifts.dept_a.current.shift_id);
    expect(res.body.template).toMatchObject({ department_code: 'dept_a', version: 1, field_definition: TEMPLATE });
    expect(res.body.incoming_staff.map((u) => u.user_id)).toEqual([world.users.incA.user_id]);
  });

  test('after the admin publishes a new version, meta returns that version', async () => {
    const next = { fields: TEMPLATE.fields.map((f) => (f.key === 'incidents' ? { ...f, required: true } : f)) };
    await as(world, 'admin').put('/api/admin/templates/dept_a', { field_definition: next });
    const res = await as(world, 'outA').get('/api/handovers/meta');
    expect(res.body.template).toMatchObject({ version: 2, field_definition: next });
  });

  test('only outgoing staff may load it (403)', async () => {
    for (const who of ['incA', 'supA', 'admin']) {
      expect((await as(world, who).get('/api/handovers/meta')).status).toBe(403);
    }
  });
});

describe('tasks (FR-05)', () => {
  const url = () => `/api/handovers/${record.record_id}/tasks`;

  test('stores description, status and priority; defaults are open and medium', async () => {
    const out = as(world, 'outA');
    const a = await out.post(url(), { description: 'Tow tug 3 to workshop', status: 'in_progress', priority: 'high' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ description: 'Tow tug 3 to workshop', status: 'in_progress', priority: 'high' });

    const b = await out.post(url(), { description: 'Refill water cart' });
    expect(b.body).toMatchObject({ status: 'open', priority: 'medium' });

    const { rows } = await pool.query('SELECT description, status, priority FROM task WHERE record_id = $1 ORDER BY created_at', [record.record_id]);
    expect(rows).toEqual([
      { description: 'Tow tug 3 to workshop', status: 'in_progress', priority: 'high' },
      { description: 'Refill water cart', status: 'open', priority: 'medium' },
    ]);
  });

  test('a draft task can be moved to resolved', async () => {
    const out = as(world, 'outA');
    const { body: task } = await out.post(url(), { description: 'Tow tug 3 to workshop' });
    const res = await out.patch(`${url()}/${task.task_id}`, { status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
  });

  test('an empty description or a status/priority outside the enum is refused (400)', async () => {
    const out = as(world, 'outA');
    expect(fields(await out.post(url(), { description: '   ' }))).toContain('description');
    expect(fields(await out.post(url(), { description: 'Valid text', status: 'done' }))).toContain('status');
    expect(fields(await out.post(url(), { description: 'Valid text', priority: 'urgent' }))).toContain('priority');
    const { rows } = await pool.query('SELECT 1 FROM task WHERE record_id = $1', [record.record_id]);
    expect(rows).toHaveLength(0);
  });
});

describe('incidents (FR-06)', () => {
  const url = () => `/api/handovers/${record.record_id}/incidents`;
  const OCCURRED = '2026-10-13T03:15:00.000Z';

  test('stores title, description, severity, time of occurrence and the reporter', async () => {
    const res = await as(world, 'outA').post(url(), {
      title: 'Bird strike on approach', description: 'Engine inspected, no damage.', severity: 'high', occurred_at: OCCURRED,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      title: 'Bird strike on approach', description: 'Engine inspected, no damage.', severity: 'high', reported_by: world.users.outA.user_id,
    });
    expect(new Date(res.body.occurred_at).toISOString()).toBe(OCCURRED);
  });

  test('a missing severity or time of occurrence, or an unknown severity, is refused (400)', async () => {
    const out = as(world, 'outA');
    expect(fields(await out.post(url(), { title: 'No severity', occurred_at: OCCURRED }))).toContain('severity');
    expect(fields(await out.post(url(), { title: 'No time', severity: 'low' }))).toContain('occurred_at');
    expect(fields(await out.post(url(), { title: 'Bad severity', severity: 'extreme', occurred_at: OCCURRED }))).toContain('severity');
    expect(fields(await out.post(url(), { severity: 'low', occurred_at: OCCURRED }))).toContain('title');
    const { rows } = await pool.query('SELECT 1 FROM incident WHERE record_id = $1', [record.record_id]);
    expect(rows).toHaveLength(0);
  });
});

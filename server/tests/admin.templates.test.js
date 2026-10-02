// Template changes create a new version; history is never overwritten.
const { pool, buildWorld, as } = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

test('PUT bumps the version, repoints the department, and keeps old versions queryable', async () => {
  const admin = as(world, 'admin');
  const v1 = (await admin.get('/api/admin/templates/dept_a')).body;
  const def = structuredClone(v1.template.field_definition);
  def.fields[0].minLength = 50;

  const put = await admin.put('/api/admin/templates/dept_a', { field_definition: def });
  expect(put.status).toBe(201);
  expect(put.body.template.version).toBe(2);

  const now = (await admin.get('/api/admin/templates/dept_a')).body;
  expect(now.current_version).toBe(2);
  expect(now.versions.map((v) => v.version)).toEqual([2, 1]);

  const old = (await admin.get('/api/admin/templates/dept_a?version=1')).body;
  expect(old.template.field_definition.fields[0].minLength).toBe(20);
});

test('an identical definition does not create a new version', async () => {
  const admin = as(world, 'admin');
  const v1 = (await admin.get('/api/admin/templates/dept_a')).body;
  const put = await admin.put('/api/admin/templates/dept_a', { field_definition: v1.template.field_definition });
  expect(put.status).toBe(200);
  expect(put.body.changed).toBe(false);
});

test('an invalid definition is rejected with the specific problems', async () => {
  const res = await as(world, 'admin').put('/api/admin/templates/dept_a', {
    field_definition: { fields: [{ key: 'unknown_field', label: 'X' }] },
  });
  expect(res.status).toBe(400);
  expect(res.body.details[0]).toMatch(/key must be one of/);
});

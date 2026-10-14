// R1: theme and email preferences live on the server, so the same user gets
// the same settings on every device. Sign-in and /me return them; PATCH
// /api/auth/me/preferences changes one or both.
const request = require('supertest');
const {
  app, pool, buildWorld, as, PASSWORD,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

const me = () => as(world, 'outA').get('/api/auth/me');
const patch = (body) => as(world, 'outA').patch('/api/auth/me/preferences', body);
const login = () => request(app).post('/api/auth/login').send({ identifier: 'T100', password: PASSWORD });

test('a new account follows the device theme, with email alerts on', async () => {
  expect((await me()).body).toMatchObject({ theme_preference: 'system', email_notifications: true });
});

test('sign-in returns the saved preferences, so a second device applies them', async () => {
  await patch({ theme_preference: 'dark', email_notifications: false });
  const { status, body } = await login();
  expect(status).toBe(200);
  expect(body.user).toMatchObject({ theme_preference: 'dark', email_notifications: false });
  expect(body.user.password_hash).toBeUndefined();
});

test('the theme can be changed alone, and the response has both settings', async () => {
  const res = await patch({ theme_preference: 'light' });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ theme_preference: 'light', email_notifications: true });
  expect((await me()).body.theme_preference).toBe('light');
});

test('both can be changed at once', async () => {
  const res = await patch({ theme_preference: 'dark', email_notifications: false });
  expect(res.body).toEqual({ theme_preference: 'dark', email_notifications: false });
});

test('rejects an unknown theme, a non-boolean switch and an empty body', async () => {
  expect((await patch({ theme_preference: 'blue' })).status).toBe(400);
  expect((await patch({ email_notifications: 'yes' })).status).toBe(400);
  const empty = await patch({});
  expect(empty.status).toBe(400);
  expect(JSON.stringify(empty.body)).toMatch(/at least one of email_notifications, theme_preference/);
  expect((await me()).body.theme_preference).toBe('system');
});

test('the database refuses any other theme value', async () => {
  await expect(pool.query("UPDATE app_user SET theme_preference = 'sepia' WHERE user_id = $1", [world.users.outA.user_id]))
    .rejects.toThrow(/check constraint/);
});

test('audits only the fields that changed, and nothing when nothing changed', async () => {
  await patch({ theme_preference: 'dark', email_notifications: true });
  await patch({ theme_preference: 'dark' });
  const { rows } = await pool.query(
    "SELECT previous_value, new_value FROM audit_log WHERE action = 'update_preferences' AND entity_id = $1 ORDER BY logged_at",
    [world.users.outA.user_id],
  );
  expect(rows).toEqual([{ previous_value: { theme_preference: 'system' }, new_value: { theme_preference: 'dark' } }]);
});

test("one user's preferences never change another's", async () => {
  await patch({ theme_preference: 'dark' });
  expect((await as(world, 'incA').get('/api/auth/me')).body.theme_preference).toBe('system');
});

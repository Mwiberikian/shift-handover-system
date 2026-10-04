// Messaging rules: cross-department direct messages are allowed; department
// broadcasts are limited to your own department unless you are a supervisor or
// admin; organisation-wide is supervisors/admins only; messages are
// append-only; sending is rate-limited per user.
const request = require('supertest');
const {
  pool, app, buildWorld, as,
} = require('./helpers/fixtures');
const { sendLimitStore } = require('../src/modules/messages/messages.routes');

let world;
beforeEach(async () => {
  world = await buildWorld();
  sendLimitStore.resetAll();
});
afterAll(() => pool.end());

const direct = (to, body = 'Stand 5 GPU is back in service.') => ({ recipient_type: 'user', recipient_user_id: to, body });
const dept = (id, body = 'Briefing at 06:00 in the ops room.') => ({ recipient_type: 'department', recipient_department_id: id, body });
const everyone = (body = 'Fire drill at 14:00.') => ({ recipient_type: 'organisation', body });

describe('direct messages', () => {
  test('work across departments, notify the recipient, and audit without the body', async () => {
    const res = await as(world, 'outA').post('/api/messages', { ...direct(world.users.incB.user_id), subject: 'GPU' });
    expect(res.status).toBe(201);

    const inbox = await as(world, 'incB').get('/api/messages/inbox');
    expect(inbox.status).toBe(200);
    expect(inbox.body.items).toHaveLength(1);
    expect(inbox.body.items[0]).toMatchObject({ body: 'Stand 5 GPU is back in service.', subject: 'GPU', sender_name: 'Test outA', unread: true });

    const { rows: notes } = await pool.query("SELECT type, message_id FROM notification WHERE recipient_id = $1 AND type = 'message'", [world.users.incB.user_id]);
    expect(notes).toEqual([{ type: 'message', message_id: res.body.message_id }]);

    const { rows: [audit] } = await pool.query("SELECT action, new_value FROM audit_log WHERE entity_type = 'message' AND entity_id = $1", [res.body.message_id]);
    expect(audit.action).toBe('send');
    expect(audit.new_value).toMatchObject({ message_id: res.body.message_id, recipient_type: 'user', recipient_user_id: world.users.incB.user_id });
    expect(JSON.stringify(audit.new_value)).not.toContain('GPU');
  });

  test('read state, unread count and the sent folder', async () => {
    const { body: m } = await as(world, 'supA').post('/api/messages', direct(world.users.outB.user_id));
    expect((await as(world, 'outB').get('/api/messages/unread-count')).body.count).toBe(1);

    const read = await as(world, 'outB').post(`/api/messages/${m.message_id}/read`);
    expect(read.status).toBe(200);
    expect((await as(world, 'outB').get('/api/messages/unread-count')).body.count).toBe(0);
    expect((await as(world, 'outB').post(`/api/messages/${m.message_id}/read`)).status).toBe(200); // idempotent

    const { rows: [n] } = await pool.query('SELECT read_at FROM notification WHERE message_id = $1', [m.message_id]);
    expect(n.read_at).not.toBeNull();

    const sent = await as(world, 'supA').get('/api/messages/sent');
    expect(sent.body.items[0]).toMatchObject({ message_id: m.message_id, recipient_name: 'Test outB' });
    expect(sent.body.items[0].recipient_read_at).not.toBeNull();
    expect((await as(world, 'supA').get('/api/messages/inbox')).body.items).toHaveLength(0);
  });

  test('a user cannot read, or mark read, another user\'s direct message by id (404)', async () => {
    const { body: m } = await as(world, 'outA').post('/api/messages', direct(world.users.incA.user_id));
    expect((await as(world, 'incA').get(`/api/messages/${m.message_id}`)).status).toBe(200);
    expect((await as(world, 'outA').get(`/api/messages/${m.message_id}`)).status).toBe(200); // sender
    for (const key of ['supA', 'outB', 'admin']) {
      expect((await as(world, key).get(`/api/messages/${m.message_id}`)).status).toBe(404);
      expect((await as(world, key).post(`/api/messages/${m.message_id}/read`)).status).toBe(404);
    }
    const { rows } = await pool.query('SELECT 1 FROM message_read WHERE message_id = $1', [m.message_id]);
    expect(rows).toHaveLength(0);
  });

  test('cannot message an inactive user or yourself, and validates the body', async () => {
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.incB.user_id]);
    expect((await as(world, 'outA').post('/api/messages', direct(world.users.incB.user_id))).status).toBe(404);
    expect((await as(world, 'outA').post('/api/messages', direct(world.users.outA.user_id))).status).toBe(400);
    expect((await as(world, 'outA').post('/api/messages', direct(world.users.incA.user_id, '   '))).status).toBe(400);
    expect((await as(world, 'outA').post('/api/messages', direct(world.users.incA.user_id, 'x'.repeat(2001)))).status).toBe(400);
    expect((await as(world, 'outA').post('/api/messages', { recipient_type: 'user', body: 'no recipient' })).status).toBe(400);
  });
});

describe('broadcasts', () => {
  test('staff can broadcast to their own department; everyone in it sees it and the read state is per user', async () => {
    const res = await as(world, 'outA').post('/api/messages', dept(world.depts.dept_a.department_id));
    expect(res.status).toBe(201);
    for (const key of ['incA', 'supA']) {
      const inbox = await as(world, key).get('/api/messages/inbox');
      expect(inbox.body.items.map((m) => m.message_id)).toEqual([res.body.message_id]);
    }
    expect((await as(world, 'incB').get('/api/messages/inbox')).body.items).toHaveLength(0);
    // No notification fan-out for broadcasts.
    expect((await pool.query("SELECT 1 FROM notification WHERE type = 'message'")).rowCount).toBe(0);

    await as(world, 'incA').post(`/api/messages/${res.body.message_id}/read`);
    expect((await as(world, 'incA').get('/api/messages/unread-count')).body.count).toBe(0);
    expect((await as(world, 'supA').get('/api/messages/unread-count')).body.count).toBe(1);
  });

  test('a non-supervisor cannot broadcast to another department (403)', async () => {
    for (const key of ['outA', 'incA']) {
      const res = await as(world, key).post('/api/messages', dept(world.depts.dept_b.department_id));
      expect(res.status).toBe(403);
    }
    expect((await pool.query('SELECT count(*)::int AS n FROM message')).rows[0].n).toBe(0);
  });

  test('supervisors and admins can broadcast to any department', async () => {
    expect((await as(world, 'supA').post('/api/messages', dept(world.depts.dept_b.department_id))).status).toBe(201);
    expect((await as(world, 'admin').post('/api/messages', dept(world.depts.dept_a.department_id))).status).toBe(201);
  });

  test('a non-supervisor cannot send organisation-wide (403)', async () => {
    for (const key of ['outA', 'incB']) {
      expect((await as(world, key).post('/api/messages', everyone())).status).toBe(403);
    }
  });

  test('supervisors and admins can send organisation-wide; every other user sees it', async () => {
    const res = await as(world, 'admin').post('/api/messages', everyone());
    expect(res.status).toBe(201);
    for (const key of ['outA', 'incB', 'supA', 'supB']) {
      expect((await as(world, key).get('/api/messages/unread-count')).body.count).toBe(1);
    }
    expect((await as(world, 'supB').post('/api/messages', everyone('Shift pattern changes next week.'))).status).toBe(201);
  });
});

describe('append-only', () => {
  test('there are no edit or delete routes', async () => {
    const { body: m } = await as(world, 'outA').post('/api/messages', direct(world.users.incA.user_id));
    expect((await as(world, 'outA').patch(`/api/messages/${m.message_id}`, { body: 'edited' })).status).toBe(404);
    expect((await as(world, 'outA').put(`/api/messages/${m.message_id}`, { body: 'edited' })).status).toBe(404);
    expect((await as(world, 'outA').delete(`/api/messages/${m.message_id}`)).status).toBe(404);
  });

  test('the database refuses UPDATE and DELETE on message and message_read', async () => {
    const { body: m } = await as(world, 'outA').post('/api/messages', direct(world.users.incA.user_id));
    await as(world, 'incA').post(`/api/messages/${m.message_id}/read`);
    await expect(pool.query("UPDATE message SET body = 'tampered' WHERE message_id = $1", [m.message_id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM message WHERE message_id = $1', [m.message_id])).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM message_read WHERE message_id = $1', [m.message_id])).rejects.toThrow(/append-only/);
    const { rows: [row] } = await pool.query('SELECT body FROM message WHERE message_id = $1', [m.message_id]);
    expect(row.body).toBe('Stand 5 GPU is back in service.');
  });

  test('the recipient columns must match the type (CHECK)', async () => {
    await expect(pool.query(
      "INSERT INTO message (sender_id, recipient_type, recipient_department_id, body) VALUES ($1, 'organisation', $2, 'x')",
      [world.users.admin.user_id, world.depts.dept_a.department_id],
    )).rejects.toThrow(/message_recipient_matches_type/);
  });
});

describe('rate limit', () => {
  test('a user can send 30 messages an hour; the 31st is refused (429) and other users are unaffected', async () => {
    const out = as(world, 'outA');
    for (let i = 0; i < 30; i++) {
      const res = await out.post('/api/messages', direct(world.users.incA.user_id, `update ${i}`));
      expect(res.status).toBe(201);
    }
    expect((await out.post('/api/messages', direct(world.users.incA.user_id, 'one too many'))).status).toBe(429);
    expect((await as(world, 'incA').post('/api/messages', direct(world.users.outA.user_id))).status).toBe(201);
  });

  test('refused sends (e.g. 403) do not use up the quota', async () => {
    for (let i = 0; i < 31; i++) {
      expect((await as(world, 'outA').post('/api/messages', everyone())).status).toBe(403);
    }
    expect((await as(world, 'outA').post('/api/messages', direct(world.users.incA.user_id))).status).toBe(201);
  });
});

describe('directory and auth', () => {
  test('directory lists active users with minimal fields only', async () => {
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.outB.user_id]);
    const res = await as(world, 'incA').get('/api/directory');
    expect(res.status).toBe(200);
    expect(res.body.map((u) => u.user_id)).not.toContain(world.users.outB.user_id);
    expect(Object.keys(res.body[0]).sort()).toEqual(['department_name', 'full_name', 'role', 'user_id']);
    const depts = await as(world, 'incA').get('/api/directory/departments');
    expect(depts.body.map((d) => Object.keys(d).sort())).toEqual([['department_id', 'name'], ['department_id', 'name']]);
  });

  test('a message notification carries the sender and subject, never the body', async () => {
    await as(world, 'outA').post('/api/messages', { ...direct(world.users.incA.user_id, 'secret body text'), subject: 'Stand 5' });
    const res = await as(world, 'incA').get('/api/notifications');
    const n = res.body.find((x) => x.type === 'message');
    expect(n).toMatchObject({ message_sender_name: 'Test outA', message_subject: 'Stand 5' });
    expect(JSON.stringify(n)).not.toContain('secret body text');
  });

  test('every messaging route requires authentication', async () => {
    expect((await request(app).get('/api/messages/inbox')).status).toBe(401);
    expect((await request(app).post('/api/messages').send(everyone())).status).toBe(401);
    expect((await request(app).get('/api/directory')).status).toBe(401);
  });
});

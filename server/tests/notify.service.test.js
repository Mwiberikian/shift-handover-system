// IR-05: notifications go through one service interface. notify() is the only
// code that inserts notification rows; channels plug in behind it.
const fs = require('fs');
const path = require('path');
const { notify, registerChannel } = require('../src/modules/notifications/notify');
const { withTransaction } = require('../src/db/tx');
const { pool, buildWorld, submitCompleteRecord } = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterAll(() => pool.end());

test('no other source file inserts into notification', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js') && /INSERT\s+INTO\s+notification\b/i.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(path.join(__dirname, '..'), full).replace(/\\/g, '/'));
      }
    }
  };
  walk(path.join(__dirname, '../src'));
  expect(offenders).toEqual(['src/modules/notifications/notify.js']);
});

test('one in-app row per distinct recipient, with title, body, refs and time', async () => {
  const at = new Date('2026-10-13T15:00:00Z');
  const rows = await notify({
    userIds: [world.users.incA.user_id, world.users.supA.user_id, world.users.incA.user_id, null],
    type: 'reminder',
    title: 'Shift starting soon',
    body: 'Your night shift starts at 18:00 EAT.',
    ref: { shift_id: world.shifts.dept_a.current.shift_id, reminder_type: 'shift_start' },
    at,
  });
  expect(rows).toHaveLength(2);
  const { rows: stored } = await pool.query('SELECT * FROM notification ORDER BY recipient_id');
  expect(stored).toHaveLength(2);
  for (const n of stored) {
    expect(n).toMatchObject({
      type: 'reminder', title: 'Shift starting soon', body: 'Your night shift starts at 18:00 EAT.',
      shift_id: world.shifts.dept_a.current.shift_id, reminder_type: 'shift_start', record_id: null, message_id: null, read_at: null,
    });
    expect(n.sent_at.toISOString()).toBe(at.toISOString());
  }
});

test('no recipients means no rows; a missing type or an unknown channel is an error and writes nothing', async () => {
  expect(await notify({ userIds: [], type: 'x' })).toEqual([]);
  await expect(notify({ userIds: [world.users.incA.user_id] })).rejects.toThrow('type is required');
  await expect(notify({ userIds: [world.users.incA.user_id], type: 'x' }, { channels: ['pigeon'] })).rejects.toThrow("unknown channel 'pigeon'");
  expect((await pool.query('SELECT 1 FROM notification')).rowCount).toBe(0);
});

test('rows commit or roll back with the caller transaction', async () => {
  await expect(withTransaction(async (client) => {
    await notify({ userIds: [world.users.incA.user_id], type: 'x' }, { db: client });
    throw new Error('caller failed');
  })).rejects.toThrow('caller failed');
  expect((await pool.query('SELECT 1 FROM notification')).rowCount).toBe(0);
});

test('extra channels run in the same transaction after the in-app rows, and in_app is always delivered', async () => {
  const seen = [];
  registerChannel('test_channel', async (db, rows, n) => {
    const { rows: [{ count }] } = await db.query('SELECT count(*)::int FROM notification');
    seen.push({ rows: rows.length, visible: count, type: n.type });
  });
  const rows = await notify({ userIds: [world.users.incA.user_id], type: 'handover_submitted' }, { channels: ['test_channel'] });
  expect(rows).toHaveLength(1);
  expect(seen).toEqual([{ rows: 1, visible: 1, type: 'handover_submitted' }]);
});

test('callers are unchanged in effect: a submit still notifies incoming staff and supervisor in-app', async () => {
  const rec = await submitCompleteRecord(world);
  const { rows } = await pool.query('SELECT recipient_id, type, record_id FROM notification ORDER BY recipient_id');
  expect(rows.map((r) => r.recipient_id).sort()).toEqual([world.users.incA.user_id, world.users.supA.user_id].sort());
  expect(rows.every((r) => r.type === 'handover_submitted' && r.record_id === rec.record_id)).toBe(true);
  expect(rec.notified.sort()).toEqual([world.users.incA.user_id, world.users.supA.user_id].sort());
});

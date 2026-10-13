// Calendar subscription feed: a private URL with a 32-byte token, stored
// hashed, shown once, revocable and regenerable; the feed is valid RFC 5545
// with a 30-minute alarm, lists only the owner's shifts, never handover
// content, and is rate-limited.
const request = require('supertest');
const { feedLimitStore } = require('../src/modules/shifts/shifts.routes');
const { hashToken } = require('../src/modules/shifts/calendarFeed');
const {
  pool, app, buildWorld, as, submitCompleteRecord,
} = require('./helpers/fixtures');

const HOUR = 3600 * 1000;

let world;
let mine;
let theirs;
beforeEach(async () => {
  world = await buildWorld();
  feedLimitStore.resetAll();
  const base = new Date(world.shifts.dept_a.current.end_time).getTime();
  const add = async (dept, offsetH, type) => (await pool.query(
    'INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING *',
    [world.depts[dept].department_id, type, new Date(base + offsetH * HOUR), new Date(base + (offsetH + 12) * HOUR)],
  )).rows[0];
  mine = await add('dept_a', 0, 'night');
  theirs = await add('dept_a', 12, 'day');
  await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2), ($1, $3)', [world.shifts.dept_a.current.shift_id, world.users.outA.user_id, world.users.incA.user_id]);
  await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [mine.shift_id, world.users.outA.user_id]);
  await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [theirs.shift_id, world.users.incA.user_id]);
});
afterAll(() => pool.end());

const createFeed = async (who = 'outA') => (await as(world, who).post('/api/auth/me/calendar-feed')).body;
const fetchFeed = (url) => request(app).get(new URL(url).pathname);

// Minimal RFC 5545 structural check: CRLF, folded lines <= 75 octets,
// balanced BEGIN/END, required properties in each VEVENT and VALARM.
function assertValidIcs(text) {
  expect(text.endsWith('\r\n')).toBe(true);
  expect(/[^\r]\n/.test(text)).toBe(false);
  const physical = text.split('\r\n').slice(0, -1);
  physical.forEach((l) => expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75));
  const lines = physical.reduce((acc, l) => (l.startsWith(' ') ? [...acc.slice(0, -1), acc.at(-1) + l.slice(1)] : [...acc, l]), []);
  expect(lines[0]).toBe('BEGIN:VCALENDAR');
  expect(lines.at(-1)).toBe('END:VCALENDAR');
  expect(lines).toEqual(expect.arrayContaining(['VERSION:2.0', expect.stringMatching(/^PRODID:/)]));
  const stack = [];
  for (const l of lines) {
    if (l.startsWith('BEGIN:')) stack.push(l.slice(6));
    if (l.startsWith('END:')) expect(stack.pop()).toBe(l.slice(4));
    expect(l).toMatch(/^[A-Z-]+[;:]/);
  }
  expect(stack).toEqual([]);
  const events = text.split('BEGIN:VEVENT').slice(1).map((e) => e.split('END:VEVENT')[0]);
  for (const e of events) {
    for (const prop of ['UID:', 'DTSTAMP:', 'DTSTART:', 'DTEND:', 'SUMMARY:']) expect(e).toContain(`\r\n${prop}`);
    expect(e).toMatch(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:[^\r]+\r\nTRIGGER:-PT30M\r\nEND:VALARM/);
  }
  return { lines, events };
}

describe('managing the feed', () => {
  test('status starts inactive; create returns the URL once; only a SHA-256 of the token is stored', async () => {
    expect((await as(world, 'outA').get('/api/auth/me/calendar-feed')).body).toEqual({ active: false, created_at: null });
    const res = await as(world, 'outA').post('/api/auth/me/calendar-feed');
    expect(res.status).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const token = /\/api\/shifts\/calendar\/([A-Za-z0-9_-]+)\.ics$/.exec(res.body.url)[1];
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);

    const status = await as(world, 'outA').get('/api/auth/me/calendar-feed');
    expect(status.body).toEqual({ active: true, created_at: expect.any(String) });
    expect(JSON.stringify(status.body)).not.toContain(token);

    const { rows: [row] } = await pool.query('SELECT calendar_feed_hash FROM app_user WHERE user_id = $1', [world.users.outA.user_id]);
    expect(row.calendar_feed_hash).toBe(hashToken(token));
    const dump = await pool.query('SELECT row_to_json(a)::text AS t FROM audit_log a');
    dump.rows.forEach(({ t }) => expect(t).not.toContain(token));
    const { rows: audit } = await pool.query("SELECT action FROM audit_log WHERE action LIKE 'calendar_feed_%'");
    expect(audit.map((a) => a.action)).toEqual(['calendar_feed_create']);
  });

  test('revoked token returns 404; regenerating invalidates the old URL', async () => {
    const first = await createFeed();
    expect((await fetchFeed(first.url)).status).toBe(200);

    const second = await createFeed();
    expect(second.url).not.toBe(first.url);
    expect((await fetchFeed(first.url)).status).toBe(404);
    expect((await fetchFeed(second.url)).status).toBe(200);

    expect((await as(world, 'outA').delete('/api/auth/me/calendar-feed')).body).toEqual({ active: false, created_at: null });
    const gone = await fetchFeed(second.url);
    expect(gone.status).toBe(404);
    expect(gone.text).toBe('Not found');

    const { rows } = await pool.query("SELECT action FROM audit_log WHERE action LIKE 'calendar_feed_%' ORDER BY log_id");
    expect(rows.map((r) => r.action)).toEqual(['calendar_feed_create', 'calendar_feed_regenerate', 'calendar_feed_revoke']);
  });

  test('unknown or malformed tokens and deactivated accounts get the same 404', async () => {
    const { url } = await createFeed();
    expect((await request(app).get(`/api/shifts/calendar/${'A'.repeat(43)}.ics`)).status).toBe(404);
    expect((await request(app).get('/api/shifts/calendar/short.ics')).status).toBe(404);
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.outA.user_id]);
    expect((await fetchFeed(url)).status).toBe(404);
  });

  test('managing the feed needs a session', async () => {
    expect((await request(app).post('/api/auth/me/calendar-feed')).status).toBe(401);
    expect((await request(app).delete('/api/auth/me/calendar-feed')).status).toBe(401);
  });
});

describe('the feed', () => {
  test('is valid iCalendar with a 30-minute alarm per shift', async () => {
    const { url } = await createFeed();
    const res = await fetchFeed(url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['cache-control']).toBe('private, no-store');
    const { events } = assertValidIcs(res.text);
    expect(events).toHaveLength(2);
  });

  test("holds only the owner's shifts", async () => {
    const out = await fetchFeed((await createFeed('outA')).url);
    const inc = await fetchFeed((await createFeed('incA')).url);
    const uids = (text) => [...text.matchAll(/UID:shift-([0-9a-f-]+)@shms/g)].map((m) => m[1]).sort();
    expect(uids(out.text)).toEqual([world.shifts.dept_a.current.shift_id, mine.shift_id].sort());
    expect(uids(inc.text)).toEqual([world.shifts.dept_a.current.shift_id, theirs.shift_id].sort());
  });

  test('contains no handover text, names or record data', async () => {
    const rec = await submitCompleteRecord(world);
    await as(world, 'outA').post('/api/messages', { recipient_type: 'user', recipient_user_id: world.users.incA.user_id, body: 'Private note about stand 5' });
    const { text } = await fetchFeed((await createFeed()).url);
    for (const secret of ['All stands clear', 'Check GPU', 'stand 5', 'Test outA', 'Test incA', rec.record_id, 'outa@test.example']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('SUMMARY:Night shift - Department dept_a');
    expect(text).toMatch(/LOCATION:Department dept_a/);
  });

  test('is rate-limited per IP', async () => {
    const { url } = await createFeed();
    let last;
    for (let i = 0; i < 61; i += 1) last = await fetchFeed(url);
    expect(last.status).toBe(429);
  });
});

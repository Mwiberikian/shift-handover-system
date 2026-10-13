// Calendar export (Part K): the hand-written iCalendar writer and the
// "Download .ics" endpoint for one shift or the next 30 days.
const ics = require('../src/utils/ics');
const { pool, buildWorld, as } = require('./helpers/fixtures');

const HOUR = 3600 * 1000;

let world;
let mine; // a future dept_a shift outA is rostered on
let other; // a future dept_a shift nobody is rostered on
beforeEach(async () => {
  world = await buildWorld();
  const start = new Date(world.shifts.dept_a.current.end_time);
  const add = async (offsetH, type) => (await pool.query(
    'INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING *',
    [world.depts.dept_a.department_id, type, new Date(start.getTime() + offsetH * HOUR), new Date(start.getTime() + (offsetH + 12) * HOUR)],
  )).rows[0];
  mine = await add(0, 'night');
  other = await add(12, 'day');
  await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [mine.shift_id, world.users.outA.user_id]);
});
afterAll(() => pool.end());

const events = (text) => text.split('BEGIN:VEVENT').length - 1;

describe('writer (RFC 5545)', () => {
  test('TEXT values escape backslash, semicolon, comma and newlines', () => {
    expect(ics.escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  test('lines longer than 75 octets fold with CRLF + space, without splitting UTF-8 characters', () => {
    const long = `SUMMARY:${'é'.repeat(60)}`; // 8 + 120 octets
    const folded = ics.fold(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(Buffer.byteLength(p)).toBeLessThanOrEqual(75);
    parts.slice(1).forEach((p) => expect(p.startsWith(' ')).toBe(true));
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
    expect(ics.fold('SHORT:line')).toBe('SHORT:line');
  });

  test('a calendar has CRLF lines, UTC times, a 30-minute alarm, and only name, times and department', () => {
    const text = ics.calendar([{
      shift_id: '11111111-2222-4333-8444-555555555555', shift_type: 'night', start_time: '2026-10-13T15:00:00Z', end_time: '2026-10-14T03:00:00Z',
      department_name: 'Ground Operations, Nairobi',
    }], { stamp: new Date('2026-10-13T10:00:00Z') });
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.split('\r\n').filter(Boolean).every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[^\r]\n/);
    const lines = text.split('\r\n');
    expect(lines).toEqual(expect.arrayContaining([
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'END:VCALENDAR',
      'UID:shift-11111111-2222-4333-8444-555555555555@shms', 'DTSTAMP:20261013T100000Z',
      'DTSTART:20261013T150000Z', 'DTEND:20261014T030000Z',
      'SUMMARY:Night shift - Ground Operations\\, Nairobi',
      'LOCATION:Ground Operations\\, Nairobi',
      'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'END:VALARM',
    ]));
    expect(text).toContain('18:00-06:00 EAT');
  });
});

describe('GET /api/shifts/calendar.ics', () => {
  test('one of your own shifts, as an attachment', async () => {
    const res = await as(world, 'outA').get(`/api/shifts/calendar.ics?shift_id=${mine.shift_id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="shift-.{8}\.ics"/);
    expect(events(res.text)).toBe(1);
    expect(res.text).toContain(`UID:shift-${mine.shift_id}@shms`);
  });

  test("staff cannot export a shift they are not on; a supervisor can for their department only", async () => {
    expect((await as(world, 'outA').get(`/api/shifts/calendar.ics?shift_id=${other.shift_id}`)).status).toBe(403);
    expect((await as(world, 'supA').get(`/api/shifts/calendar.ics?shift_id=${other.shift_id}`)).status).toBe(200);
    expect((await as(world, 'supB').get(`/api/shifts/calendar.ics?shift_id=${other.shift_id}`)).status).toBe(403);
    expect((await as(world, 'outA').get('/api/shifts/calendar.ics?shift_id=00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  test('the next 30 days of your own shifts', async () => {
    const res = await as(world, 'outA').get('/api/shifts/calendar.ics?days=30');
    expect(events(res.text)).toBe(1);
    expect(res.headers['content-disposition']).toMatch(/shifts-next-30-days\.ics/);
    expect(events((await as(world, 'incA').get('/api/shifts/calendar.ics')).text)).toBe(0);
  });

  test('the department roster for a supervisor (not for staff)', async () => {
    const res = await as(world, 'supA').get('/api/shifts/calendar.ics?scope=department');
    // current (not ended), mine, other; the previous shift has ended.
    expect(events(res.text)).toBe(3);
    expect((await as(world, 'outA').get('/api/shifts/calendar.ics?scope=department')).status).toBe(403);
    expect(events((await as(world, 'supB').get('/api/shifts/calendar.ics?scope=department')).text)).toBe(1);
  });

  test('bad parameters are a 400 and the endpoint needs a session', async () => {
    expect((await as(world, 'outA').get('/api/shifts/calendar.ics?days=365')).status).toBe(400);
    expect((await as(world, 'outA').get('/api/shifts/calendar.ics?scope=all')).status).toBe(400);
    const anon = await require('supertest')(require('../src/app')).get('/api/shifts/calendar.ics');
    expect(anon.status).toBe(401);
  });
});

test('GET /api/shifts/mine/upcoming lists your rostered shifts that have not ended', async () => {
  const res = await as(world, 'outA').get('/api/shifts/mine/upcoming');
  expect(res.body.map((s) => s.shift_id)).toEqual([mine.shift_id]);
  expect(Object.keys(res.body[0]).sort()).toEqual(['department_name', 'end_time', 'shift_id', 'shift_type', 'start_time']);
});

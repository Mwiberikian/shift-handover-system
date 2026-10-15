// Part L3: one report as a PDF, many as CSV - who may download, what the
// files contain, the export cap, the audit rows and the rate limit.
const { pool, buildWorld, as } = require('./helpers/fixtures');
const { pdfText, pageCount } = require('./helpers/pdfText');
const { downloadLimitStore } = require('../src/modules/reports/reports.routes');
const { toCsv, csvCell, EXPORT_MAX_ROWS } = require('../src/modules/reports/reports.download');
const { formatEAT } = require('../src/utils/eat');

const DONE = 'Checked GPU on stand 5 and cleared the backlog.';
const PENDING = 'Fuel truck 3 still waiting for a part.';

let world;
beforeEach(async () => {
  world = await buildWorld();
  downloadLimitStore.resetAll();
});
afterAll(() => pool.end());

const binary = (req) => req.buffer(true).parse((res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});

async function submitted(who, { done = DONE, pending = PENDING, title } = {}) {
  const dept = world.users[who].department_id === world.depts.dept_b.department_id ? 'dept_b' : 'dept_a';
  await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [world.shifts[dept].current.shift_id, world.users[who].user_id]);
  const { body: d } = await as(world, who).post('/api/reports');
  await as(world, who).patch(`/api/reports/${d.report_id}`, {
    done_text: done, pending_text: pending, nothing_pending: false, ...(title && { title }),
  });
  const res = await as(world, who).post(`/api/reports/${d.report_id}/submit`);
  if (res.status !== 200) throw new Error(`submit: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const pdfOf = (who, id) => binary(as(world, who).get(`/api/reports/${id}/download?format=pdf`));

describe('GET /api/reports/:id/download?format=pdf', () => {
  test('an A4 PDF with the system name, report, shift in EAT, linked tasks, session time and a footer', async () => {
    const r = await submitted('outA');
    const res = await pdfOf('supA', r.report_id);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="shift-report-\d{4}-\d{2}-\d{2}-T100\.pdf"$/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.body.length).toBeGreaterThan(1000);
    expect(res.body.toString('latin1')).toMatch(/\/MediaBox \[0 0 595.28 841.89\]/); // A4 in points

    const text = pdfText(res.body);
    const shift = world.shifts.dept_a.current;
    for (const expected of [
      'SHIFT HANDOVER MANAGEMENT SYSTEM', r.title, 'Test outA (T100)', 'Department dept_a',
      `Current shift, ${formatEAT(shift.start_time)} to ${formatEAT(shift.end_time)}`,
      'What was done', DONE, 'What is pending', PENDING, 'Linked tasks', 'None.', '0 h 00 min',
      'Downloaded by Test supA (T102) on ', 'Page 1 of 1',
    ]) expect(text).toContain(expected);
  });

  test('long reports run to several pages, each numbered', async () => {
    const long = Array.from({ length: 90 }, (_, i) => `Line ${i + 1} of the long account of the shift.`).join('\n');
    const r = await submitted('outA', { done: long.slice(0, 5000) });
    const res = await pdfOf('outA', r.report_id);
    const pages = pageCount(res.body);
    expect(pages).toBeGreaterThan(1);
    const text = pdfText(res.body);
    for (let p = 1; p <= pages; p += 1) expect(text).toContain(`Page ${p} of ${pages}`);
  });

  test('author, recipient, the department\'s supervisor and admin may download; others 403; every download is audited', async () => {
    const r = await submitted('outA');
    await as(world, 'outA').post(`/api/reports/${r.report_id}/share`, { user_ids: [world.users.incA.user_id] });
    for (const who of ['outA', 'incA', 'supA', 'admin']) expect((await pdfOf(who, r.report_id)).status).toBe(200);
    for (const who of ['outB', 'supB']) expect((await pdfOf(who, r.report_id)).status).toBe(403);

    const { rows } = await pool.query(
      `SELECT u.staff_number, a.new_value FROM audit_log a JOIN app_user u USING (user_id)
        WHERE a.entity_type = 'report' AND a.action = 'download' ORDER BY a.log_id`,
    );
    expect(rows.map((x) => [x.staff_number, x.new_value.format, x.new_value.access, x.new_value.row_count])).toEqual([
      ['T100', 'pdf', 'author', 1], ['T101', 'pdf', 'recipient', 1], ['T102', 'pdf', 'supervisor', 1], ['T900', 'pdf', 'admin', 1],
    ]);
  });

  test('format other than pdf is a 400', async () => {
    const r = await submitted('outA');
    expect((await as(world, 'outA').get(`/api/reports/${r.report_id}/download?format=docx`)).status).toBe(400);
    expect((await as(world, 'outA').get(`/api/reports/${r.report_id}/download`)).status).toBe(400);
  });
});

describe('CSV writer', () => {
  test('neutralises cells that start with = + - @ tab or CR', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) expect(csvCell(bad).replace(/^"/, '')).toMatch(/^'/);
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('fine')).toBe('fine');
    expect(csvCell('a, b')).toBe('"a, b"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });

  test('UTF-8 BOM and CRLF record ends (RFC 4180)', () => {
    expect(toCsv(['a', 'b'], [['1', 'x"y']])).toBe('﻿a,b\r\n1,"x""y"\r\n');
  });
});

describe('GET /api/reports/export?format=csv', () => {
  const exportCsv = (who, qs = '') => as(world, who).get(`/api/reports/export?format=csv${qs}`);

  test('supervisors export their department\'s submitted reports; injected formulas are neutralised', async () => {
    const r = await submitted('outA', { title: '=HYPERLINK("http://evil.example")', done: '+1 and then some more text' });
    await submitted('outB');
    const res = await exportCsv('supA');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="shift-reports-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.text.charCodeAt(0)).toBe(0xFEFF);
    const lines = res.text.slice(1).split('\r\n');
    expect(lines[0]).toBe('report_id,title,author_staff_number,author_name,department,shift_type,shift_start_eat,shift_end_eat,submitted_at_eat,done,pending,nothing_pending,linked_tasks,session_minutes');
    expect(lines).toHaveLength(3); // header, one row, trailing empty
    expect(lines[1]).toContain(r.report_id);
    expect(lines[1]).toContain('"\'=HYPERLINK(""http://evil.example"")"');
    expect(lines[1]).toContain("'+1 and then some more text");
    expect(lines[1]).toContain(`${formatEAT(world.shifts.dept_a.current.start_time)}`);
  });

  test('filters by department (id or code), author (id or staff number) and dates; admin sees all', async () => {
    const a = await submitted('outA');
    const b = await submitted('outB');
    const ids = async (who, qs) => (await exportCsv(who, qs)).text.split('\r\n').slice(1, -1).map((l) => l.split(',')[0]).sort();
    expect(await ids('admin', '')).toEqual([a.report_id, b.report_id].sort());
    expect(await ids('admin', '&department=DEPT_B')).toEqual([b.report_id]);
    expect(await ids('admin', `&department=${world.depts.dept_a.department_id}`)).toEqual([a.report_id]);
    expect(await ids('admin', '&author=t200')).toEqual([b.report_id]);
    expect(await ids('admin', `&from=${new Date(Date.now() + 86400000).toISOString()}`)).toEqual([]);
    expect((await exportCsv('admin', '&department=nowhere')).status).toBe(400);
  });

  test('workers 403; a supervisor of another department 403; wrong format 400', async () => {
    expect((await exportCsv('outA')).status).toBe(403);
    expect((await exportCsv('incA')).status).toBe(403);
    expect((await exportCsv('supA', '&department=dept_b')).status).toBe(403);
    expect((await as(world, 'supA').get('/api/reports/export?format=xlsx')).status).toBe(400);
  });

  test('audited with the filters and row count', async () => {
    await submitted('outA');
    await exportCsv('supA', '&author=T100');
    const { rows: [row] } = await pool.query("SELECT user_id, new_value FROM audit_log WHERE entity_type = 'report_export'");
    expect(row.user_id).toBe(world.users.supA.user_id);
    expect(row.new_value).toEqual({ format: 'csv', filters: { author: 'T100' }, row_count: 1 });
  });

  test(`more than ${EXPORT_MAX_ROWS} rows is a clear 400 and writes no file`, async () => {
    const shift = world.shifts.dept_a.current;
    await pool.query(
      `INSERT INTO report (author_id, shift_id, title, done_text, nothing_pending, status, submitted_at)
       SELECT $1, $2, 'Synthetic report ' || g, 'Synthetic text for the cap test.', true, 'submitted', now()
         FROM generate_series(1, $3) g`,
      [world.users.outA.user_id, shift.shift_id, EXPORT_MAX_ROWS + 1],
    );
    const res = await exportCsv('supA');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/would have 5001 reports; the limit is 5000\. Narrow/);
    expect(res.body.details).toMatchObject({ code: 'export_too_large', row_count: 5001, max_rows: 5000 });
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_type = 'report_export'")).rows[0].n).toBe(0);

    // Narrowing the date range brings it under the cap.
    expect((await exportCsv('supA', `&to=${new Date(new Date(shift.start_time).getTime() - 1000).toISOString()}`)).status).toBe(200);
  });
});

describe('rate limit', () => {
  test('20 downloads an hour per user (PDF and CSV together); refused requests do not count', async () => {
    const r = await submitted('outA');
    for (let i = 0; i < 3; i += 1) expect((await pdfOf('outB', r.report_id)).status).toBe(403); // not counted
    for (let i = 0; i < 10; i += 1) expect((await pdfOf('supA', r.report_id)).status).toBe(200);
    for (let i = 0; i < 10; i += 1) expect((await as(world, 'supA').get('/api/reports/export?format=csv')).status).toBe(200);
    const res = await pdfOf('supA', r.report_id);
    expect(res.status).toBe(429);
    expect(JSON.parse(res.body.toString()).error).toMatch(/too many reports/);
    // Per user: another user is unaffected.
    expect((await pdfOf('outA', r.report_id)).status).toBe(200);
  });
});

// Report downloads (Part L3): one report as a PDF, or many as CSV.
//
// PDF (GET /api/reports/:id/download?format=pdf): anyone who can see the
// report (author, recipients, the department's supervisors, admin).
// CSV (GET /api/reports/export?format=csv): supervisors for their own
// department, admins for any; submitted reports only; at most 5000 rows.
// Every download is audited with the format, the filters and the row count.
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { formatEAT } = require('../../utils/eat');
const service = require('./reports.service');

const SYSTEM_NAME = 'Shift Handover Management System';
const EXPORT_MAX_ROWS = 5000;

const capitalise = (s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function formatDuration(ms) {
  const minutes = Math.round(Number(ms) / 60000);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

const shiftLine = (r) => `${capitalise(r.shift_type)} shift, ${formatEAT(r.shift_start)} to ${formatEAT(r.shift_end)}`;

async function downloader(db, userId) {
  const { rows: [u] } = await db.query('SELECT full_name, staff_number FROM app_user WHERE user_id = $1', [userId]);
  return u;
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

// Builds the PDF in memory and resolves with a Buffer.
function renderPdf(report, { tasks, sessionMs, downloadedBy, downloadedAt }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 56, bufferPages: true,
      info: { Title: report.title, Author: report.author_name, Creator: SYSTEM_NAME },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const heading = (text) => doc.moveDown(0.8).font('Helvetica-Bold').fontSize(12).text(text).moveDown(0.3).font('Helvetica').fontSize(10.5);
    const field = (label, value) => doc.font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(value);

    doc.font('Helvetica').fontSize(9).fillColor('#555555').text(SYSTEM_NAME.toUpperCase(), { characterSpacing: 0.5 });
    doc.moveDown(0.4).fillColor('#000000').font('Helvetica-Bold').fontSize(18).text(report.title);
    if (report.status !== 'submitted') doc.moveDown(0.2).fontSize(10).fillColor('#a00000').text('DRAFT - not submitted').fillColor('#000000');
    doc.moveDown(0.6).fontSize(10.5);
    field('Author', `${report.author_name} (${report.author_staff_number})`);
    field('Department', report.department_name);
    field('Shift', shiftLine(report));
    field('Submitted', report.submitted_at ? formatEAT(report.submitted_at) : 'not yet');
    field('Session time on this shift', formatDuration(sessionMs));

    heading('What was done');
    doc.text(report.done_text || '(nothing written)');
    heading('What is pending');
    doc.text(report.nothing_pending ? 'Nothing pending.' : (report.pending_text || '(nothing written)'));

    heading('Linked tasks');
    if (!tasks.length) doc.text('None.');
    for (const t of tasks) {
      doc.text(`- ${t.description} (${t.status.replace('_', ' ')}, ${t.priority} priority)`, { indent: 0 });
    }

    // Footer on every page: who downloaded it, when, and the page number.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      const { bottom } = doc.page.margins;
      doc.page.margins.bottom = 0; // writing inside the margin must not add a page
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text(
        `Downloaded by ${downloadedBy.full_name} (${downloadedBy.staff_number}) on ${formatEAT(downloadedAt)}    Page ${i - range.start + 1} of ${range.count}`,
        56, doc.page.height - 36, { width: doc.page.width - 112, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

async function pdf(user, reportId) {
  return withTransaction(async (client) => {
    const report = await service.fetchReport(client, reportId);
    const access = await service.assertCanView(client, user, report);
    const [tasks, sessionMs, by, { rows: [{ now }] }] = [
      await service.linkedTasks(client, reportId),
      await service.sessionDurationMs(client, report),
      await downloader(client, user.user_id),
      await client.query('SELECT now()'),
    ];
    const body = await renderPdf(report, {
      tasks, sessionMs, downloadedBy: by, downloadedAt: now,
    });
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report', entityId: reportId, action: 'download',
      newValue: { format: 'pdf', access, row_count: 1, bytes: body.length },
    });
    const file = `shift-report-${formatEAT(report.shift_start, 'date')}-${report.author_staff_number}.pdf`.replace(/[^\w.-]/g, '_');
    return { body, file };
  });
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

// A cell that a spreadsheet would read as a formula gets a leading quote.
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// RFC 4180: CRLF between records, fields quoted when needed. UTF-8 with a BOM
// so spreadsheet programs read accented names correctly.
function toCsv(header, rows) {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const CSV_HEADER = [
  'report_id', 'title', 'author_staff_number', 'author_name', 'department', 'shift_type', 'shift_start_eat',
  'shift_end_eat', 'submitted_at_eat', 'done', 'pending', 'nothing_pending', 'linked_tasks', 'session_minutes',
];

// `department` may be an id or a code; `author` an id or a staff number.
async function resolveFilters(db, user, q) {
  if (!service.MANAGERS.includes(user.role)) throw new AppError(403, 'Only supervisors and administrators can export reports');
  const filters = { scope: 'department' };
  if (q.from) filters.from = q.from;
  if (q.to) filters.to = q.to;
  if (q.department) {
    const { rows: [d] } = await db.query(
      'SELECT department_id FROM department WHERE department_id::text = $1 OR lower(code) = lower($1)', [q.department],
    );
    if (!d) throw new AppError(400, 'Unknown department', [{ field: 'department', message: `${q.department} is not a department id or code` }]);
    filters.department_id = d.department_id;
  }
  if (q.author) {
    const { rows: [a] } = await db.query(
      'SELECT user_id FROM app_user WHERE user_id::text = $1 OR upper(staff_number) = upper($1)', [q.author],
    );
    if (!a) throw new AppError(400, 'Unknown author', [{ field: 'author', message: `${q.author} is not a user id or staff number` }]);
    filters.author_id = a.user_id;
  }
  return filters;
}

async function csv(user, q) {
  return withTransaction(async (client) => {
    const filters = await resolveFilters(client, user, q);
    const params = [];
    const where = service.scopeWhere(user, filters, params); // department scope: submitted only
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const { rows: [{ total }] } = await client.query(
      `SELECT count(*)::int AS total FROM report r JOIN shift s ON s.shift_id = r.shift_id ${whereSql}`, params,
    );
    if (total > EXPORT_MAX_ROWS) {
      throw new AppError(400, `This export would have ${total} reports; the limit is ${EXPORT_MAX_ROWS}. Narrow the date range, department or author and try again.`, {
        code: 'export_too_large', row_count: total, max_rows: EXPORT_MAX_ROWS,
      });
    }
    const { rows } = await client.query(
      `SELECT q.*,
              (SELECT count(*)::int FROM report_task t WHERE t.report_id = q.report_id) AS linked_tasks,
              (SELECT COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(w.ended_at, now()) - w.started_at))), 0)
                 FROM work_session w WHERE w.user_id = q.author_id AND w.shift_id = q.shift_id) AS session_seconds
         FROM (${service.REPORT_SELECT} ${whereSql}) q
        ORDER BY q.shift_start, q.submitted_at, q.report_id`,
      params,
    );
    const body = toCsv(CSV_HEADER, rows.map((r) => [
      r.report_id, r.title, r.author_staff_number, r.author_name, r.department_name, r.shift_type,
      formatEAT(r.shift_start), formatEAT(r.shift_end), formatEAT(r.submitted_at), r.done_text,
      r.nothing_pending ? '' : r.pending_text, r.nothing_pending ? 'yes' : 'no', r.linked_tasks,
      Math.round(Number(r.session_seconds) / 60),
    ]));
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report_export', entityId: crypto.randomUUID(), action: 'download',
      newValue: {
        format: 'csv', filters: { ...q, format: undefined }, row_count: rows.length,
      },
    });
    const { rows: [{ today }] } = await client.query("SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS today");
    return { body, file: `shift-reports-${today}.csv`, rowCount: rows.length };
  });
}

module.exports = {
  pdf, csv, renderPdf, toCsv, csvCell, EXPORT_MAX_ROWS, SYSTEM_NAME,
};

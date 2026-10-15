// Shift reports (Part L2).
//
// Who sees what:
//  - A draft is visible to its author only.
//  - A submitted report is visible to its author, the people it was shared
//    with, the supervisors of its department (the department of its shift)
//    and administrators.
// Who may share a submitted report: its author, a supervisor of its
// department, or an administrator. Recipients cannot pass it on.
// Share rules (by the sharer's role):
//  - outgoing and incoming staff: active colleagues in their own department
//    (not administrators) and active supervisors of any department;
//  - supervisors and administrators: any active user.
// Every create, update, submit, share and read is audited.
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { notify } = require('../notifications/notify');
const { formatEAT } = require('../../utils/eat');
const sessions = require('../sessions/sessions.service');
const { REPORT_TEXT, REPORT_TITLE_MAX } = require('../../config/constants');

const WORKERS = ['outgoing_staff', 'incoming_staff'];
const MANAGERS = ['supervisor', 'admin'];

const REPORT_SELECT = `
  SELECT r.report_id, r.author_id, r.shift_id, r.title, r.done_text, r.pending_text, r.nothing_pending,
         r.status, r.created_at, r.submitted_at,
         a.full_name AS author_name, a.staff_number AS author_staff_number, a.role AS author_role,
         s.shift_type, s.start_time AS shift_start, s.end_time AS shift_end,
         d.department_id, d.name AS department_name, d.code AS department_code
    FROM report r
    JOIN app_user a ON a.user_id = r.author_id
    JOIN shift s ON s.shift_id = r.shift_id
    JOIN department d ON d.department_id = s.department_id`;

const auditView = (r) => ({
  title: r.title, status: r.status, nothing_pending: r.nothing_pending, submitted_at: r.submitted_at,
  done_length: r.done_text.length, pending_length: r.pending_text.length,
});

async function fetchReport(db, reportId) {
  const { rows: [r] } = await db.query(`${REPORT_SELECT} WHERE r.report_id = $1`, [reportId]);
  if (!r) throw new AppError(404, 'Report not found');
  return r;
}

async function isRecipient(db, reportId, userId) {
  const { rows } = await db.query('SELECT 1 FROM report_share WHERE report_id = $1 AND user_id = $2', [reportId, userId]);
  return rows.length > 0;
}

// How the caller relates to a report: 'author' | 'recipient' | 'supervisor' |
// 'admin' | null (no access).
async function accessOf(db, user, report) {
  if (report.author_id === user.user_id) return 'author';
  if (report.status !== 'submitted') return null;
  if (user.role === 'admin') return 'admin';
  if (user.role === 'supervisor' && user.department_id === report.department_id) return 'supervisor';
  if (await isRecipient(db, report.report_id, user.user_id)) return 'recipient';
  return null;
}

async function assertCanView(db, user, report) {
  const access = await accessOf(db, user, report);
  if (!access) throw new AppError(403, 'You do not have access to this report');
  return access;
}

function assertAuthorDraft(user, report) {
  if (report.author_id !== user.user_id) throw new AppError(403, 'Only the author may change this report');
  if (report.status !== 'draft') throw new AppError(409, 'This report has been submitted and can no longer be changed');
}

// ---------------------------------------------------------------------------
// Create (prefilled)
// ---------------------------------------------------------------------------

// The window to prefill from: the caller's active work session, or else the
// shift they are rostered on now (from its start).
async function currentWindow(db, user) {
  const session = await sessions.activeSession(db, user.user_id);
  if (session) return { shiftId: session.shift_id, from: session.started_at, sessionId: session.session_id };
  const shift = await sessions.currentAssignedShift(db, user.user_id);
  if (shift) return { shiftId: shift.shift_id, from: shift.start_time, sessionId: null };
  return null;
}

// Tasks the caller resolved in the window (from the audit trail: every task
// write is audited), and the open or in-progress tasks on the shift's
// handover records they own or receive, or that they timed this session.
async function prefillTasks(db, user, window) {
  const { rows: resolved } = await db.query(
    `SELECT DISTINCT ON (k.task_id) k.task_id, k.description, k.status, k.priority
       FROM audit_log a JOIN task k ON k.task_id = a.entity_id
      WHERE a.entity_type = 'task' AND a.user_id = $1 AND a.logged_at >= $2
        AND a.action IN ('create', 'update') AND a.new_value->>'status' = 'resolved'
        AND k.status = 'resolved'
      ORDER BY k.task_id`,
    [user.user_id, window.from],
  );
  const { rows: pending } = await db.query(
    `SELECT k.task_id, k.description, k.status, k.priority
       FROM task k JOIN handover_record r ON r.record_id = k.record_id
      WHERE k.status IN ('open', 'in_progress')
        AND ((r.shift_id = $2 AND (r.outgoing_user_id = $1 OR r.incoming_user_id = $1))
          OR k.task_id IN (SELECT task_id FROM task_timer WHERE session_id = $3))
      ORDER BY k.priority DESC, k.created_at`,
    [user.user_id, window.shiftId, window.sessionId],
  );
  return { resolved, pending };
}

const clip = (text) => (text.length > REPORT_TEXT.max ? `${text.slice(0, REPORT_TEXT.max - 1)}…` : text);
const bullet = (t) => `- ${t.description}${t.status === 'in_progress' ? ' (in progress)' : ''}`;

async function create(user) {
  return withTransaction(async (client) => {
    const window = await currentWindow(client, user);
    if (!window) {
      throw new AppError(409, 'Start your shift (or be rostered on the shift that is on now) before writing a report.', { code: 'no_current_shift' });
    }
    // One draft per author and shift: a second "New report" reopens it.
    const { rows: [existing] } = await client.query(
      "SELECT report_id FROM report WHERE author_id = $1 AND shift_id = $2 AND status = 'draft' ORDER BY created_at DESC LIMIT 1",
      [user.user_id, window.shiftId],
    );
    if (existing) return { created: false, ...(await detail(client, existing.report_id)) };

    const { resolved, pending } = await prefillTasks(client, user, window);
    const { rows: [shift] } = await client.query('SELECT shift_type, start_time FROM shift WHERE shift_id = $1', [window.shiftId]);
    const title = `${shift.shift_type.charAt(0).toUpperCase()}${shift.shift_type.slice(1)} shift report ${formatEAT(shift.start_time, 'date')}`;
    const { rows: [report] } = await client.query(
      `INSERT INTO report (author_id, shift_id, title, done_text, pending_text, nothing_pending)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        user.user_id, window.shiftId, title.slice(0, REPORT_TITLE_MAX),
        clip(resolved.map(bullet).join('\n')), clip(pending.map(bullet).join('\n')), pending.length === 0,
      ],
    );
    const linked = [...new Set([...resolved, ...pending].map((t) => t.task_id))];
    if (linked.length) {
      await client.query('INSERT INTO report_task (report_id, task_id) SELECT $1, unnest($2::uuid[])', [report.report_id, linked]);
    }
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report', entityId: report.report_id, action: 'create',
      newValue: { ...auditView(report), shift_id: window.shiftId, session_id: window.sessionId, task_ids: linked },
    });
    return { created: true, ...(await detail(client, report.report_id)) };
  });
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

// The author's total work-session time on the report's shift.
async function sessionDurationMs(db, report) {
  const { rows: [{ total }] } = await db.query(
    `SELECT COALESCE(sum(EXTRACT(EPOCH FROM (COALESCE(ended_at, now()) - started_at)) * 1000), 0)::bigint AS total,
            count(*)::int AS n
       FROM work_session WHERE user_id = $1 AND shift_id = $2`,
    [report.author_id, report.shift_id],
  );
  return Number(total);
}

async function linkedTasks(db, reportId) {
  const { rows } = await db.query(
    `SELECT k.task_id, k.description, k.status, k.priority
       FROM report_task rt JOIN task k ON k.task_id = rt.task_id
      WHERE rt.report_id = $1 ORDER BY k.status, k.created_at`,
    [reportId],
  );
  return rows;
}

async function shares(db, reportId) {
  const { rows } = await db.query(
    `SELECT rs.user_id, u.full_name, u.role, rs.shared_at, rs.read_at, rs.shared_by, b.full_name AS shared_by_name
       FROM report_share rs JOIN app_user u ON u.user_id = rs.user_id JOIN app_user b ON b.user_id = rs.shared_by
      WHERE rs.report_id = $1 ORDER BY rs.shared_at, u.full_name`,
    [reportId],
  );
  return rows;
}

async function detail(db, reportId, access = 'author') {
  const report = await fetchReport(db, reportId);
  return {
    ...report,
    tasks: await linkedTasks(db, reportId),
    session_duration_ms: await sessionDurationMs(db, report),
    // Recipients see who sent it to them, not the whole list.
    shares: access === 'recipient' ? [] : await shares(db, reportId),
    access,
  };
}

// GET /api/reports/:id. Audited ('read'); a recipient's first read sets read_at.
async function get(user, reportId) {
  return withTransaction(async (client) => {
    const report = await fetchReport(client, reportId);
    const access = await assertCanView(client, user, report);
    if (access === 'recipient') {
      await client.query(
        'UPDATE report_share SET read_at = now() WHERE report_id = $1 AND user_id = $2 AND read_at IS NULL',
        [reportId, user.user_id],
      );
    }
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report', entityId: reportId, action: 'read', newValue: { access },
    });
    return detail(client, reportId, access);
  });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const MAX_PAGE_SIZE = 100;
const paging = ({ page = 1, page_size: pageSize = 20 }) => {
  const size = Math.min(Math.max(Number(pageSize) || 20, 1), MAX_PAGE_SIZE);
  const p = Math.max(Number(page) || 1, 1);
  return { size, offset: (p - 1) * size, page: p };
};

// Builds WHERE clauses for a scope and filters. Shared by the list and the
// CSV export. `params` is appended to.
function scopeWhere(user, query, params) {
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${params.length}`)); };
  const scope = query.scope || 'mine';

  if (scope === 'mine') {
    add('r.author_id = ?', user.user_id);
  } else if (scope === 'shared') {
    add("r.status = 'submitted' AND EXISTS (SELECT 1 FROM report_share x WHERE x.report_id = r.report_id AND x.user_id = ?)", user.user_id);
  } else if (scope === 'department') {
    if (!MANAGERS.includes(user.role)) throw new AppError(403, 'Only supervisors and administrators can list department reports');
    where.push("r.status = 'submitted'");
    if (user.role === 'supervisor') {
      if (query.department_id && query.department_id !== user.department_id) throw new AppError(403, 'Resource belongs to another department');
      add('s.department_id = ?', user.department_id);
    } else if (query.department_id) {
      add('s.department_id = ?', query.department_id);
    }
  }
  if (query.from) add('s.start_time >= ?', query.from);
  if (query.to) add('s.start_time <= ?', query.to);
  if (query.author_id) add('r.author_id = ?', query.author_id);
  if (query.shift_id) add('r.shift_id = ?', query.shift_id);
  if (query.status) add('r.status = ?', query.status);
  return where;
}

async function list(user, query) {
  const params = [];
  const where = scopeWhere(user, query, params);
  const { size, offset, page } = paging(query);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { rows: [{ total }] } = await pool.query(
    `SELECT count(*)::int AS total FROM report r JOIN shift s ON s.shift_id = r.shift_id ${whereSql}`,
    params,
  );
  const n = params.length;
  const { rows } = await pool.query(
    `SELECT q.*,
            (SELECT read_at FROM report_share x WHERE x.report_id = q.report_id AND x.user_id = $${n + 1}) AS my_read_at,
            (SELECT count(*)::int FROM report_share x WHERE x.report_id = q.report_id) AS share_count
       FROM (${REPORT_SELECT} ${whereSql}
             ORDER BY s.start_time DESC, r.created_at DESC, r.report_id
             LIMIT $${n + 2} OFFSET $${n + 3}) q
      ORDER BY q.shift_start DESC, q.created_at DESC, q.report_id`,
    [...params, user.user_id, size, offset],
  );
  // List rows carry no report text.
  const items = rows.map(({ done_text: _d, pending_text: _p, ...r }) => r);
  return {
    items, page, page_size: size, total, scope: query.scope || 'mine',
  };
}

// ---------------------------------------------------------------------------
// Update and submit (author, draft only)
// ---------------------------------------------------------------------------

async function lockReport(client, reportId) {
  const { rows: [r] } = await client.query('SELECT * FROM report WHERE report_id = $1 FOR UPDATE', [reportId]);
  if (!r) throw new AppError(404, 'Report not found');
  return r;
}

// Tasks a report may link to: tasks on handover records of the author's
// department.
async function assertLinkableTasks(client, user, taskIds) {
  if (!taskIds.length) return;
  const { rows } = await client.query(
    `SELECT k.task_id FROM task k JOIN handover_record h ON h.record_id = k.record_id
      WHERE k.task_id = ANY($1::uuid[]) AND h.department_id = $2`,
    [taskIds, user.department_id],
  );
  const ok = new Set(rows.map((r) => r.task_id));
  const bad = taskIds.filter((id) => !ok.has(id));
  if (bad.length) throw new AppError(400, 'Only tasks from your own department can be linked', bad.map((id) => ({ field: 'task_ids', message: `${id} cannot be linked` })));
}

async function update(user, reportId, body) {
  return withTransaction(async (client) => {
    const before = await lockReport(client, reportId);
    assertAuthorDraft(user, before);
    const next = { ...before };
    for (const key of ['title', 'done_text', 'pending_text', 'nothing_pending']) {
      if (key in body) next[key] = body[key];
    }
    const { rows: [after] } = await client.query(
      `UPDATE report SET title = $2, done_text = $3, pending_text = $4, nothing_pending = $5
        WHERE report_id = $1 AND status = 'draft' RETURNING *`,
      [reportId, next.title, next.done_text, next.pending_text, next.nothing_pending],
    );
    let taskIds;
    if (Array.isArray(body.task_ids)) {
      taskIds = [...new Set(body.task_ids)];
      await assertLinkableTasks(client, user, taskIds);
      await client.query('DELETE FROM report_task WHERE report_id = $1 AND NOT (task_id = ANY($2::uuid[]))', [reportId, taskIds]);
      await client.query('INSERT INTO report_task (report_id, task_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING', [reportId, taskIds]);
    }
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report', entityId: reportId, action: 'update',
      previousValue: auditView(before), newValue: { ...auditView(after), ...(taskIds && { task_ids: taskIds }) },
    });
    return detail(client, reportId);
  });
}

// What a report still needs before it can be submitted.
function missingFields(r) {
  const missing = [];
  const len = (s) => (s || '').trim().length;
  const { min, max } = REPORT_TEXT;
  if (!len(r.title)) missing.push({ field: 'title', label: 'Title', reason: 'required' });
  if (len(r.done_text) < min || len(r.done_text) > max) {
    missing.push({ field: 'done_text', label: 'What was done', reason: `must be ${min} to ${max} characters` });
  }
  if (!r.nothing_pending && (len(r.pending_text) < min || len(r.pending_text) > max)) {
    missing.push({ field: 'pending_text', label: 'What is pending', reason: `must be ${min} to ${max} characters, or tick "Nothing pending"` });
  }
  return missing;
}

async function submit(user, reportId) {
  return withTransaction(async (client) => {
    const before = await lockReport(client, reportId);
    assertAuthorDraft(user, before);
    const missing = missingFields(before);
    if (missing.length) {
      throw new AppError(422, `Report not submitted: missing ${missing.map((m) => m.field).join(', ')}`, { missing_fields: missing });
    }
    // Trimmed here, not with btrim(), which strips only spaces: the lengths
    // checked above are then the lengths stored.
    const { rows: [after] } = await client.query(
      `UPDATE report SET status = 'submitted', submitted_at = now(), title = $2, done_text = $3, pending_text = $4
        WHERE report_id = $1 AND status = 'draft' RETURNING *`,
      [reportId, before.title.trim(), before.done_text.trim(), before.pending_text.trim()],
    );
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report', entityId: reportId, action: 'submit',
      previousValue: auditView(before), newValue: auditView(after),
    });
    return detail(client, reportId);
  });
}

// ---------------------------------------------------------------------------
// Share
// ---------------------------------------------------------------------------

// Users the caller may share with (share rules above), never themselves.
async function shareCandidates(user) {
  const worker = WORKERS.includes(user.role);
  const { rows } = await pool.query(
    `SELECT u.user_id, u.full_name, u.role, u.department_id, d.name AS department_name
       FROM app_user u LEFT JOIN department d ON d.department_id = u.department_id
      WHERE u.is_active AND u.user_id <> $1
        AND (NOT $2::boolean OR (u.department_id = $3 AND u.role <> 'admin') OR u.role = 'supervisor')
      ORDER BY (u.department_id IS NOT DISTINCT FROM $3) DESC, d.name NULLS LAST, u.full_name`,
    [user.user_id, worker, user.department_id],
  );
  return rows;
}

async function share(user, reportId, { user_ids: userIds, email = false }) {
  return withTransaction(async (client) => {
    const report = await fetchReport(client, reportId);
    const access = await accessOf(client, user, report);
    if (!['author', 'supervisor', 'admin'].includes(access)) {
      throw new AppError(403, 'Only the author, a supervisor of the department or an administrator can share this report');
    }
    if (report.status !== 'submitted') throw new AppError(409, 'Submit the report before sharing it');

    const ids = [...new Set(userIds)];
    const allowed = new Set((await shareCandidates(user)).map((c) => c.user_id));
    const refused = ids.filter((id) => !allowed.has(id) || id === report.author_id);
    if (refused.length) {
      throw new AppError(400, WORKERS.includes(user.role)
        ? 'You can share only with colleagues in your department and with supervisors'
        : 'Reports can be shared only with active users other than the author', refused.map((id) => ({ field: 'user_ids', message: `${id} cannot receive this report` })));
    }

    const { rows: added } = await client.query(
      `INSERT INTO report_share (report_id, user_id, shared_by)
       SELECT $1, unnest($2::uuid[]), $3
       ON CONFLICT ON CONSTRAINT report_share_once DO NOTHING
       RETURNING user_id`,
      [reportId, ids, user.user_id],
    );
    const newIds = added.map((r) => r.user_id);
    const already = ids.filter((id) => !newIds.includes(id));
    // In-app always; email only when asked. The email carries the title and a
    // link (email/content.js), never the report's text.
    await notify({
      userIds: newIds,
      type: 'report_shared',
      title: `Shift report shared with you: ${report.title}`.slice(0, REPORT_TITLE_MAX),
      ref: { report_id: reportId },
    }, { db: client, channels: email ? ['in_app', 'email'] : ['in_app'] });
    await writeAudit(client, {
      userId: user.user_id, entityType: 'report', entityId: reportId, action: 'share',
      newValue: { user_ids: newIds, already_shared: already, email: Boolean(email) },
    });
    return { shared: newIds, already_shared: already, shares: await shares(client, reportId) };
  });
}

module.exports = {
  create, get, list, update, submit, share, shareCandidates,
  // for downloads
  REPORT_SELECT, fetchReport, accessOf, assertCanView, scopeWhere, linkedTasks, sessionDurationMs, MANAGERS,
};

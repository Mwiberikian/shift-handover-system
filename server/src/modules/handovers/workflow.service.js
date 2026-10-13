/**
 * Phase 4: what happens to a record after submission.
 *
 *   submitted --acknowledge--> acknowledged --review(approved)--> closed
 *       |  ^                         |  \--review(escalated)--> escalated --resolve--> closed
 *     query clarify             open-review
 *       v  |                         v
 *     queried                   under_review --review(approved|escalated)--> closed | escalated
 *
 * A record cannot reach 'closed' without passing through 'acknowledged'; the
 * DB trigger enforces the same transition table.
 */
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { assertDepartmentAccess } = require('../../middleware/auth');
const {
  RECORD_SELECT, auditView, lockRecord, assertStatus, assertOutgoingOwner, fetchDetail, loadTemplate, notifyRecord,
} = require('./handovers.service');
const { UNACK_ALERT_HOURS } = require('../../config/constants');

// Who may read a single record.
function assertCanView(user, record) {
  assertDepartmentAccess(user, record.department_id);
  if (user.role === 'incoming_staff' && record.incoming_user_id !== user.user_id) {
    throw new AppError(403, 'This handover is not assigned to you');
  }
  if (user.role === 'outgoing_staff' && record.outgoing_user_id !== user.user_id) {
    throw new AppError(403, 'This handover was created by another staff member');
  }
}

function assertAssignedIncoming(user, record) {
  assertDepartmentAccess(user, record.department_id);
  if (record.incoming_user_id !== user.user_id) {
    throw new AppError(403, 'This handover is not assigned to you');
  }
}

async function setStatus(client, record, status, extraSql = '') {
  const { rows: [updated] } = await client.query(
    `UPDATE handover_record SET status = $2 ${extraSql} WHERE record_id = $1 RETURNING *`,
    [record.record_id, status],
  );
  return updated;
}

async function getById(user, recordId) {
  const { rows: [base] } = await pool.query('SELECT * FROM handover_record WHERE record_id = $1', [recordId]);
  if (!base) throw new AppError(404, 'Handover record not found');
  assertCanView(user, base);

  const [detail, ack, reviews, thread, template] = await Promise.all([
    fetchDetail(pool, recordId),
    pool.query('SELECT * FROM acknowledgement WHERE record_id = $1', [recordId]),
    pool.query(
      `SELECT sr.*, u.full_name AS supervisor_name FROM supervisor_review sr
         JOIN app_user u ON u.user_id = sr.supervisor_id
        WHERE sr.record_id = $1 ORDER BY sr.reviewed_at`,
      [recordId],
    ),
    // Query / clarification conversation, reconstructed from the audit trail.
    pool.query(
      `SELECT a.action, a.new_value->>'comments' AS comments, a.logged_at, u.full_name AS by_name
         FROM audit_log a LEFT JOIN app_user u ON u.user_id = a.user_id
        WHERE a.entity_type = 'handover_record' AND a.entity_id = $1
          AND a.action IN ('query', 'clarify', 'acknowledge', 'open_review', 'review', 'resolve')
        ORDER BY a.logged_at, a.log_id`,
      [recordId],
    ),
    loadTemplate(pool, base.department_id),
  ]);
  return { ...detail, acknowledgement: ack.rows[0] || null, reviews: reviews.rows, thread: thread.rows, template };
}

// GET /api/handovers/:id/export (FR-20): the full record for archiving or
// printing. Same access rules as getById. Audit entries cover the record and
// every row attached to it (tasks, incidents, acknowledgement, reviews).
async function exportRecord(user, recordId) {
  const record = await getById(user, recordId);
  const { thread, ...rest } = record;
  const childIds = [
    ...record.tasks.map((t) => t.task_id),
    ...record.incidents.map((i) => i.incident_id),
    ...record.reviews.map((r) => r.review_id),
    ...(record.acknowledgement ? [record.acknowledgement.ack_id] : []),
  ];
  const { rows: audit } = await pool.query(
    `SELECT a.log_id, a.logged_at, a.user_id, u.full_name AS user_name, a.entity_type, a.entity_id, a.action,
            a.previous_value, a.new_value
       FROM audit_log a LEFT JOIN app_user u ON u.user_id = a.user_id
      WHERE (a.entity_type = 'handover_record' AND a.entity_id = $1)
         OR a.entity_id = ANY($2::uuid[])
      ORDER BY a.logged_at, a.log_id`,
    [recordId, childIds],
  );
  return {
    format: 'shms.handover_record.v1',
    exported_at: new Date().toISOString(),
    exported_by: user.user_id,
    record: rest,
    audit_log: audit,
  };
}

async function acknowledge(user, recordId, { comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertAssignedIncoming(user, record);
    assertStatus(record, 'submitted');

    const { rows: [prevAck] } = await client.query('SELECT * FROM acknowledgement WHERE record_id = $1', [recordId]);
    const { rows: [ack] } = await client.query(
      `INSERT INTO acknowledgement (record_id, incoming_user_id, confirmed_at, comments)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (record_id) DO UPDATE
         SET incoming_user_id = EXCLUDED.incoming_user_id,
             confirmed_at = EXCLUDED.confirmed_at,
             comments = COALESCE(EXCLUDED.comments, acknowledgement.comments)
       RETURNING *`,
      [recordId, user.user_id, comments || null],
    );
    const updated = await setStatus(client, record, 'acknowledged');

    await writeAudit(client, {
      userId: user.user_id, entityType: 'acknowledgement', entityId: ack.ack_id,
      action: prevAck ? 'update' : 'create', previousValue: prevAck || null, newValue: ack,
    });
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'acknowledge',
      previousValue: auditView(record), newValue: { ...auditView(updated), comments: comments || null },
    });
    await notifyRecord(client, [record.outgoing_user_id], recordId, 'handover_acknowledged');
    return getByIdTx(client, recordId);
  });
}

async function raiseQuery(user, recordId, { comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertAssignedIncoming(user, record);
    assertStatus(record, 'submitted');

    const { rows: [prevAck] } = await client.query('SELECT * FROM acknowledgement WHERE record_id = $1', [recordId]);
    const { rows: [ack] } = await client.query(
      `INSERT INTO acknowledgement (record_id, incoming_user_id, query_raised, comments)
       VALUES ($1, $2, true, $3)
       ON CONFLICT (record_id) DO UPDATE
         SET incoming_user_id = EXCLUDED.incoming_user_id, query_raised = true, comments = EXCLUDED.comments
       RETURNING *`,
      [recordId, user.user_id, comments],
    );
    const updated = await setStatus(client, record, 'queried');

    await writeAudit(client, {
      userId: user.user_id, entityType: 'acknowledgement', entityId: ack.ack_id,
      action: prevAck ? 'update' : 'create', previousValue: prevAck || null, newValue: ack,
    });
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'query',
      previousValue: auditView(record), newValue: { ...auditView(updated), comments },
    });
    await notifyRecord(client, [record.outgoing_user_id], recordId, 'handover_queried');
    return getByIdTx(client, recordId);
  });
}

// The clarification text is kept in audit_log (the record itself is locked).
async function clarify(user, recordId, { comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertOutgoingOwner(user, record);
    assertStatus(record, 'queried');

    const updated = await setStatus(client, record, 'submitted');
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'clarify',
      previousValue: auditView(record), newValue: { ...auditView(updated), comments },
    });
    await notifyRecord(client, [record.incoming_user_id], recordId, 'handover_clarified');
    return getByIdTx(client, recordId);
  });
}

// Marks an acknowledged record as being reviewed. Who opened it and when are
// kept in audit_log (action 'open_review'), not on the record.
async function openReview(user, recordId) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertDepartmentAccess(user, record.department_id);
    assertStatus(record, 'acknowledged');

    const updated = await setStatus(client, record, 'under_review');
    const { rows: [{ now: openedAt }] } = await client.query('SELECT now()');
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'open_review',
      previousValue: auditView(record),
      newValue: { ...auditView(updated), opened_by: user.user_id, opened_at: openedAt },
    });
    return getByIdTx(client, recordId);
  });
}

async function review(user, recordId, { decision, comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertDepartmentAccess(user, record.department_id);
    assertStatus(record, 'acknowledged', 'under_review');

    const { rows: [rev] } = await client.query(
      `INSERT INTO supervisor_review (record_id, supervisor_id, decision, comments)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [recordId, user.user_id, decision, comments || null],
    );
    const updated = decision === 'approved'
      ? await setStatus(client, record, 'closed', ', closed_at = now()')
      : await setStatus(client, record, 'escalated');

    await writeAudit(client, {
      userId: user.user_id, entityType: 'supervisor_review', entityId: rev.review_id, action: 'create', newValue: rev,
    });
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'review',
      previousValue: auditView(record), newValue: { ...auditView(updated), decision, comments: comments || null },
    });
    await notifyRecord(
      client,
      [record.outgoing_user_id, record.incoming_user_id],
      recordId,
      decision === 'approved' ? 'handover_closed' : 'handover_escalated',
    );
    return getByIdTx(client, recordId);
  });
}

// Closes an escalated record. Recorded as a second supervisor_review row
// (decision 'approved') so the review history shows who resolved it.
async function resolve(user, recordId, { comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertDepartmentAccess(user, record.department_id);
    assertStatus(record, 'escalated');

    const { rows: [rev] } = await client.query(
      `INSERT INTO supervisor_review (record_id, supervisor_id, decision, comments)
       VALUES ($1, $2, 'approved', $3) RETURNING *`,
      [recordId, user.user_id, comments || null],
    );
    const updated = await setStatus(client, record, 'closed', ', closed_at = now()');

    await writeAudit(client, {
      userId: user.user_id, entityType: 'supervisor_review', entityId: rev.review_id, action: 'create', newValue: rev,
    });
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'resolve',
      previousValue: auditView(record), newValue: { ...auditView(updated), comments: comments || null },
    });
    // Its own type, so that resolving an escalation can be emailed while an
    // ordinary approval (handover_closed) stays in-app.
    await notifyRecord(client, [record.outgoing_user_id, record.incoming_user_id], recordId, 'handover_resolved');
    return getByIdTx(client, recordId);
  });
}

// Detail view read inside the caller's transaction (sees its uncommitted writes).
async function getByIdTx(client, recordId) {
  const detail = await fetchDetail(client, recordId);
  const { rows: [ack] } = await client.query('SELECT * FROM acknowledgement WHERE record_id = $1', [recordId]);
  return { ...detail, acknowledgement: ack || null };
}

async function resolveDepartmentFilter(user, { department_id: deptId, department_code: deptCode }) {
  let departmentId = deptId || null;
  if (deptCode) {
    const { rows: [d] } = await pool.query('SELECT department_id FROM department WHERE code = $1', [deptCode]);
    if (!d) throw new AppError(404, `Unknown department '${deptCode}'`);
    departmentId = d.department_id;
  }
  if (departmentId) assertDepartmentAccess(user, departmentId);
  // Supervisors are always scoped to their own department.
  if (!departmentId && user.role !== 'admin') departmentId = user.department_id;
  return departmentId;
}

// GET /api/handovers/search?from&to&department_id|department_code&status&shift_type&shift_id&q
// Date range applies to the shift start time. shift_type is 'day' or 'night';
// shift_id picks one shift (FR-16).
async function search(user, query) {
  const departmentId = await resolveDepartmentFilter(user, query);
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${params.length}`)); };

  if (departmentId) add('r.department_id = ?', departmentId);
  if (query.status) add('r.status = ?', query.status);
  if (query.shift_type) add('s.shift_type = ?', query.shift_type);
  if (query.shift_id) add('r.shift_id = ?', query.shift_id);
  if (query.from) add('s.start_time >= ?', query.from);
  if (query.to) add('s.start_time <= ?', query.to);
  if (query.q) {
    add(`(r.summary_notes ILIKE ? OR EXISTS (
            SELECT 1 FROM task t WHERE t.record_id = r.record_id AND t.description ILIKE ?))`,
    `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }

  const { rows } = await pool.query(
    `${RECORD_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.start_time DESC, r.created_at DESC LIMIT 200`,
    params,
  );
  return rows;
}

// GET /api/dashboard/supervisor?scope=current|all (FR-14)
//
// scope=current (default): each department's counts cover only its current
// shift and the one before it, i.e. the two most recent shifts that have
// started. scope=all: every record. Overdue items follow the same window;
// older_outstanding says how many overdue records the window leaves out, so a
// supervisor is never silently shown "none overdue" while older ones exist.
//
// Acknowledgement completion rate = records past acknowledgement
// (acknowledged, under_review, escalated, closed) / records submitted
// (anything but draft). The DB trigger only lets a record reach those
// statuses through 'acknowledged' (NFR-19). null when nothing was submitted.
const ACKNOWLEDGED_STATUSES = ['acknowledged', 'under_review', 'escalated', 'closed'];

async function supervisorDashboard(user, query) {
  const departmentId = await resolveDepartmentFilter(user, query);
  const scope = query.scope === 'all' ? 'all' : 'current';

  // The two most recent started shifts per department.
  const { rows: windowShifts } = await pool.query(
    `SELECT d.department_id, w.shift_id, w.shift_type, w.start_time, w.end_time
       FROM department d
       CROSS JOIN LATERAL (
         SELECT s.shift_id, s.shift_type, s.start_time, s.end_time FROM shift s
          WHERE s.department_id = d.department_id AND s.start_time <= now()
          ORDER BY s.start_time DESC LIMIT 2) w
      WHERE ($1::uuid IS NULL OR d.department_id = $1)
      ORDER BY d.department_id, w.start_time DESC`,
    [departmentId],
  );
  const windowIds = windowShifts.map((s) => s.shift_id);
  const inWindow = (alias) => `($2::text = 'all' OR ${alias}.shift_id = ANY($3::uuid[]))`;

  const { rows: departments } = await pool.query(
    `SELECT d.department_id, d.code, d.name,
            count(r.*) FILTER (WHERE r.status <> 'closed')       AS open,
            count(r.*) FILTER (WHERE r.status = 'draft')         AS draft,
            count(r.*) FILTER (WHERE r.status = 'submitted')     AS submitted,
            count(r.*) FILTER (WHERE r.status = 'queried')       AS queried,
            count(r.*) FILTER (WHERE r.status = 'acknowledged')  AS acknowledged,
            count(r.*) FILTER (WHERE r.status = 'under_review')  AS under_review,
            count(r.*) FILTER (WHERE r.status = 'escalated')     AS escalated,
            count(r.*) FILTER (WHERE r.status = 'closed')        AS closed,
            count(r.*) FILTER (WHERE r.status <> 'draft')        AS acknowledgement_due,
            count(r.*) FILTER (WHERE r.status = ANY($4::record_status_enum[])) AS acknowledgement_done
       FROM department d
       LEFT JOIN handover_record r ON r.department_id = d.department_id AND ${inWindow('r')}
      WHERE ($1::uuid IS NULL OR d.department_id = $1)
      GROUP BY d.department_id ORDER BY d.name`,
    [departmentId, scope, windowIds, ACKNOWLEDGED_STATUSES],
  );

  // Submitted (or queried) but still not acknowledged more than N hours after
  // the incoming shift started. A record belongs to the outgoing shift, so
  // the incoming shift starts at that shift's end_time. (Measuring from the
  // outgoing shift's start flagged every handover the moment it was submitted.)
  // The shift-reminders job raises the same condition as a notification.
  const { rows: overdue } = await pool.query(
    `${RECORD_SELECT}
      WHERE r.status IN ('submitted', 'queried')
        AND s.end_time + make_interval(hours => $2) < now()
        AND ($1::uuid IS NULL OR r.department_id = $1)
      ORDER BY s.start_time`,
    [departmentId, UNACK_ALERT_HOURS],
  );
  const windowSet = new Set(windowIds);
  const alerts = scope === 'all' ? overdue : overdue.filter((a) => windowSet.has(a.shift_id));

  // IR-07: email alerts that finally failed. An email belongs to the
  // department of its record, else its shift, else its recipient. With
  // scope=current only failures since the start of the preceding shift count.
  // The recipient's name is shown, not their address.
  const { rows: failedEmails } = await pool.query(
    `SELECT n.notification_id, n.type, n.reminder_type, n.record_id, n.email_status_at AS failed_at,
            o.attempts, o.last_error, u.full_name AS recipient_name,
            COALESCE(r.department_id, s.department_id, u.department_id) AS department_id
       FROM notification n
       JOIN email_outbox o ON o.notification_id = n.notification_id
       JOIN app_user u ON u.user_id = n.recipient_id
       LEFT JOIN handover_record r ON r.record_id = n.record_id
       LEFT JOIN shift s ON s.shift_id = n.shift_id
      WHERE n.email_status = 'failed'
        AND ($1::uuid IS NULL OR COALESCE(r.department_id, s.department_id, u.department_id) = $1)
      ORDER BY n.email_status_at DESC`,
    [departmentId],
  );
  const windowStart = windowShifts.reduce((acc, s) => {
    const t = new Date(s.start_time).getTime();
    acc[s.department_id] = Math.min(acc[s.department_id] ?? t, t);
    return acc;
  }, {});
  const emailFailures = scope === 'all' ? failedEmails
    : failedEmails.filter((f) => windowStart[f.department_id] !== undefined && new Date(f.failed_at).getTime() >= windowStart[f.department_id]);
  const failuresByDept = emailFailures.reduce((acc, f) => ((acc[f.department_id] ||= 0), (acc[f.department_id] += 1), acc), {});

  // count() comes back from pg as a bigint string.
  const COUNT_KEYS = ['open', 'draft', 'submitted', 'queried', 'acknowledged', 'under_review', 'escalated', 'closed',
    'acknowledgement_due', 'acknowledgement_done'];
  const toInt = (row) => ({ ...row, ...Object.fromEntries(COUNT_KEYS.map((k) => [k, Number(row[k])])) });
  const alertsByDept = alerts.reduce((acc, a) => ((acc[a.department_id] ||= []).push(a), acc), {});
  const shiftsByDept = windowShifts.reduce((acc, s) => {
    const { department_id: dept, ...shift } = s;
    (acc[dept] ||= []).push(shift);
    return acc;
  }, {});

  return {
    generated_at: new Date().toISOString(),
    scope,
    threshold_hours: UNACK_ALERT_HOURS,
    departments: departments.map((d) => {
      const row = toInt(d);
      return {
        ...row,
        acknowledgement_rate: row.acknowledgement_due ? row.acknowledgement_done / row.acknowledgement_due : null,
        unacknowledged_overdue: (alertsByDept[d.department_id] || []).length,
        failed_emails: failuresByDept[d.department_id] || 0,
        // Newest first: [current, preceding]. Present in both scopes.
        window_shifts: shiftsByDept[d.department_id] || [],
      };
    }),
    unacknowledged_alerts: alerts.map((a) => ({
      ...a,
      overdue_unacknowledged: true,
      // Hours since the incoming shift started (i.e. since handover was due).
      hours_since_shift_start: Math.round(((Date.now() - new Date(a.shift_end)) / 36e5) * 10) / 10,
    })),
    older_outstanding: overdue.length - alerts.length,
    failed_emails: emailFailures,
  };
}

module.exports = { getById, exportRecord, acknowledge, raiseQuery, clarify, openReview, review, resolve, search, supervisorDashboard };

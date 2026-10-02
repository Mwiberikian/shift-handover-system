/**
 * Phase 4: what happens to a record after submission.
 *
 *   submitted --acknowledge--> acknowledged --review(approved)--> closed
 *       |  ^                           \--review(escalated)--> escalated --resolve--> closed
 *     query clarify
 *       v  |
 *     queried
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
  RECORD_SELECT, auditView, lockRecord, assertStatus, assertOutgoingOwner, fetchDetail, loadTemplate, notify,
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
          AND a.action IN ('query', 'clarify', 'acknowledge', 'review', 'resolve')
        ORDER BY a.logged_at, a.log_id`,
      [recordId],
    ),
    loadTemplate(pool, base.department_id),
  ]);
  return { ...detail, acknowledgement: ack.rows[0] || null, reviews: reviews.rows, thread: thread.rows, template };
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
    await notify(client, [record.outgoing_user_id], recordId, 'handover_acknowledged');
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
    await notify(client, [record.outgoing_user_id], recordId, 'handover_queried');
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
    await notify(client, [record.incoming_user_id], recordId, 'handover_clarified');
    return getByIdTx(client, recordId);
  });
}

async function review(user, recordId, { decision, comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertDepartmentAccess(user, record.department_id);
    assertStatus(record, 'acknowledged');

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
    await notify(
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
    await notify(client, [record.outgoing_user_id, record.incoming_user_id], recordId, 'handover_closed');
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

// GET /api/handovers/search?from&to&department_id|department_code&status&q
// Date range applies to the shift start time.
async function search(user, query) {
  const departmentId = await resolveDepartmentFilter(user, query);
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replaceAll('?', `$${params.length}`)); };

  if (departmentId) add('r.department_id = ?', departmentId);
  if (query.status) add('r.status = ?', query.status);
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

// GET /api/dashboard/supervisor
async function supervisorDashboard(user, query) {
  const departmentId = await resolveDepartmentFilter(user, query);

  const { rows: departments } = await pool.query(
    `SELECT d.department_id, d.code, d.name,
            count(r.*) FILTER (WHERE r.status <> 'closed')       AS open,
            count(r.*) FILTER (WHERE r.status = 'draft')         AS draft,
            count(r.*) FILTER (WHERE r.status = 'submitted')     AS submitted,
            count(r.*) FILTER (WHERE r.status = 'queried')       AS queried,
            count(r.*) FILTER (WHERE r.status = 'acknowledged')  AS acknowledged,
            count(r.*) FILTER (WHERE r.status = 'under_review')  AS under_review,
            count(r.*) FILTER (WHERE r.status = 'escalated')     AS escalated,
            count(r.*) FILTER (WHERE r.status = 'closed')        AS closed
       FROM department d LEFT JOIN handover_record r ON r.department_id = d.department_id
      WHERE ($1::uuid IS NULL OR d.department_id = $1)
      GROUP BY d.department_id ORDER BY d.name`,
    [departmentId],
  );

  // Submitted (or queried) but still not acknowledged more than N hours after
  // the shift started.
  const { rows: alerts } = await pool.query(
    `${RECORD_SELECT}
      WHERE r.status IN ('submitted', 'queried')
        AND s.start_time + make_interval(hours => $2) < now()
        AND ($1::uuid IS NULL OR r.department_id = $1)
      ORDER BY s.start_time`,
    [departmentId, UNACK_ALERT_HOURS],
  );

  // count() comes back from pg as a bigint string.
  const COUNT_KEYS = ['open', 'draft', 'submitted', 'queried', 'acknowledged', 'under_review', 'escalated', 'closed'];
  const toInt = (row) => ({ ...row, ...Object.fromEntries(COUNT_KEYS.map((k) => [k, Number(row[k])])) });
  const alertsByDept = alerts.reduce((acc, a) => ((acc[a.department_id] ||= []).push(a), acc), {});

  return {
    generated_at: new Date().toISOString(),
    threshold_hours: UNACK_ALERT_HOURS,
    departments: departments.map((d) => ({
      ...toInt(d),
      unacknowledged_overdue: (alertsByDept[d.department_id] || []).length,
    })),
    unacknowledged_alerts: alerts.map((a) => ({
      ...a,
      overdue_unacknowledged: true,
      hours_since_shift_start: Math.round(((Date.now() - new Date(a.shift_start)) / 36e5) * 10) / 10,
    })),
  };
}

module.exports = { getById, acknowledge, raiseQuery, clarify, review, resolve, search, supervisorDashboard };

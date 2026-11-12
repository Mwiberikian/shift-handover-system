const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { assertDepartmentAccess } = require('../../middleware/auth');
const { findMissingFields } = require('./template.validation');
const { notify } = require('../notifications/notify');
const { stopTimersForRecord } = require('../sessions/sessions.service');
const { rosterDutyEnabled } = require('../../config/flags');
const { isStaff, incomingRoster, canAuthorShift } = require('./duty');

const RECORD_SELECT = `
  SELECT r.*, s.shift_type, s.start_time AS shift_start, s.end_time AS shift_end,
         d.code AS department_code, d.name AS department_name,
         ou.full_name AS outgoing_name, iu.full_name AS incoming_name
    FROM handover_record r
    JOIN shift s USING (shift_id)
    JOIN department d ON d.department_id = r.department_id
    LEFT JOIN app_user ou ON ou.user_id = r.outgoing_user_id
    LEFT JOIN app_user iu ON iu.user_id = r.incoming_user_id`;

// Columns snapshotted into audit_log previous_value/new_value.
const auditView = (r) => ({
  status: r.status,
  summary_notes: r.summary_notes,
  incoming_user_id: r.incoming_user_id,
  submitted_at: r.submitted_at,
  closed_at: r.closed_at,
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Loads and row-locks a record for the rest of the transaction, so concurrent
// submit/acknowledge/review calls on the same record are serialised.
async function lockRecord(client, recordId) {
  const { rows: [record] } = await client.query(
    'SELECT * FROM handover_record WHERE record_id = $1 FOR UPDATE',
    [recordId],
  );
  if (!record) throw new AppError(404, 'Handover record not found');
  return record;
}

// Service-layer immutability guard. The DB trigger enforces the same rule.
function assertDraft(record) {
  if (record.status !== 'draft') {
    throw new AppError(409, `Handover record is '${record.status}' and locked against edits`, {
      record_id: record.record_id, status: record.status,
    });
  }
}

function assertStatus(record, ...allowed) {
  if (!allowed.includes(record.status)) {
    throw new AppError(409, `Handover record is '${record.status}'; this action requires status ${allowed.map((s) => `'${s}'`).join(' or ')}`, {
      record_id: record.record_id, status: record.status,
    });
  }
}

function assertOutgoingOwner(user, record) {
  assertDepartmentAccess(user, record.department_id);
  if (record.outgoing_user_id !== user.user_id) {
    throw new AppError(403, 'Only the outgoing staff member who created this handover may change it');
  }
}

async function loadTemplate(db, departmentId) {
  const { rows: [tpl] } = await db.query(
    `SELECT t.* FROM department d JOIN handover_template t ON t.template_id = d.template_id
      WHERE d.department_id = $1`,
    [departmentId],
  );
  if (!tpl) throw new AppError(409, 'Department has no handover template configured');
  return tpl;
}

async function findCurrentShift(db, departmentId) {
  const { rows: [shift] } = await db.query(
    `SELECT * FROM shift
      WHERE department_id = $1 AND start_time <= now() AND end_time > now()
      ORDER BY start_time DESC LIMIT 1`,
    [departmentId],
  );
  return shift || null;
}

// Who may be named as the receiver. With roster duty on and a rostered next
// shift, the receiver must be on that roster (any staff role); otherwise
// today's rule applies exactly (an active incoming_staff member of the
// department). `shift` is the record's shift row (needed for the roster path);
// `authorId` is the record's author, who (flag on) may never name themselves.
async function assertValidIncoming(db, departmentId, incomingUserId, shift = null, authorId = null) {
  if (incomingUserId === null || incomingUserId === undefined) return;
  if (rosterDutyEnabled() && authorId && incomingUserId === authorId) {
    throw new AppError(400, 'You cannot name yourself as the incoming person for your own handover');
  }
  if (rosterDutyEnabled() && shift) {
    const { ids } = await incomingRoster(db, shift);
    if (ids.length) {
      if (!ids.includes(incomingUserId)) {
        throw new AppError(400, "incoming_user_id must be on the next shift's roster");
      }
      return;
    }
  }
  const { rows: [u] } = await db.query(
    `SELECT 1 FROM app_user WHERE user_id = $1 AND department_id = $2
        AND role = 'incoming_staff' AND is_active`,
    [incomingUserId, departmentId],
  );
  if (!u) throw new AppError(400, 'incoming_user_id must be an active incoming_staff member of the same department');
}

// Notification about a record, in the caller's transaction (via the
// notification service): in-app always, and an email alert queued for the
// types and recipients that qualify (email/channel.js). Returns the
// recipients' ids.
async function notifyRecord(client, recipientIds, recordId, type) {
  const rows = await notify({ userIds: recipientIds, type, ref: { record_id: recordId } }, { db: client, channels: ['email', 'push'] });
  return rows.map((r) => r.recipient_id);
}

async function departmentSupervisorIds(db, departmentId) {
  const { rows } = await db.query(
    `SELECT user_id FROM app_user WHERE department_id = $1 AND role = 'supervisor' AND is_active`,
    [departmentId],
  );
  return rows.map((r) => r.user_id);
}

async function fetchRecord(db, recordId) {
  const { rows: [record] } = await db.query(`${RECORD_SELECT} WHERE r.record_id = $1`, [recordId]);
  if (!record) throw new AppError(404, 'Handover record not found');
  return record;
}

async function fetchDetail(db, recordId) {
  const record = await fetchRecord(db, recordId);
  const [tasks, incidents] = await Promise.all([
    db.query(
      `SELECT t.*, src.record_id AS carried_from_record_id
         FROM task t LEFT JOIN task src ON src.task_id = t.carried_from_task_id
        WHERE t.record_id = $1 ORDER BY t.created_at, t.task_id`,
      [recordId],
    ),
    db.query(
      `SELECT i.*, u.full_name AS reported_by_name
         FROM incident i LEFT JOIN app_user u ON u.user_id = i.reported_by
        WHERE i.record_id = $1 ORDER BY i.occurred_at`,
      [recordId],
    ),
  ]);
  return { ...record, tasks: tasks.rows, incidents: incidents.rows };
}

// ---------------------------------------------------------------------------
// Phase 3: record lifecycle up to submission
// ---------------------------------------------------------------------------

async function list(user, query) {
  const params = [];
  const where = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (query.department_id) {
    assertDepartmentAccess(user, query.department_id);
    add('r.department_id = ?', query.department_id);
  }

  if (rosterDutyEnabled() && isStaff(user.role)) {
    // Phase 3: a staff member sees what they authored or received (as today)
    // plus the records of shifts they are rostered on (their outgoing duty)
    // and of shifts whose next shift they are rostered on (their incoming
    // duty). Includes today's scope, so nothing a person could see disappears.
    // The roster-derived part is limited to the person's own department.
    params.push(user.user_id);
    const me = `$${params.length}`;
    params.push(user.department_id);
    const myDept = `$${params.length}`;
    where.push(`(r.outgoing_user_id = ${me} OR r.incoming_user_id = ${me}
      OR (r.department_id = ${myDept} AND (
        EXISTS (SELECT 1 FROM shift_assignment sa WHERE sa.shift_id = r.shift_id AND sa.user_id = ${me})
        OR EXISTS (SELECT 1 FROM shift_assignment sa2
                    WHERE sa2.user_id = ${me}
                      AND sa2.shift_id = (SELECT n.shift_id FROM shift n
                                           WHERE n.department_id = r.department_id AND n.start_time >= s.end_time
                                           ORDER BY n.start_time LIMIT 1)))))`);
  } else {
    switch (user.role) {
      case 'outgoing_staff': add('r.outgoing_user_id = ?', user.user_id); break;
      case 'incoming_staff': add('r.incoming_user_id = ?', user.user_id); break;
      case 'supervisor': add('r.department_id = ?', user.department_id); break;
      default: break; // admin: all departments
    }
  }
  if (query.status) add('r.status = ?', query.status);

  const { rows } = await pool.query(
    `${RECORD_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.start_time DESC, r.created_at DESC LIMIT 200`,
    params,
  );
  return rows;
}

// Data the outgoing-staff form needs: current shift, template, who can receive.
// With roster duty on and a rostered next shift, the receiver candidates are
// that roster (any staff role) and a sole candidate is suggested; otherwise
// the department's incoming_staff, exactly as before. The author is never
// offered as their own receiver.
const fixedRoleIncoming = (departmentId) => pool.query(
  `SELECT user_id, staff_number, full_name FROM app_user
    WHERE department_id = $1 AND role = 'incoming_staff' AND is_active ORDER BY full_name`,
  [departmentId],
);

async function meta(user) {
  if (!rosterDutyEnabled()) {
    // Flag off: exactly main's three queries, in parallel.
    const [shift, template, incoming] = await Promise.all([
      findCurrentShift(pool, user.department_id),
      loadTemplate(pool, user.department_id),
      fixedRoleIncoming(user.department_id),
    ]);
    return { current_shift: shift, template, incoming_staff: incoming.rows };
  }
  const [shift, template] = await Promise.all([
    findCurrentShift(pool, user.department_id),
    loadTemplate(pool, user.department_id),
  ]);
  if (shift) {
    const { ids } = await incomingRoster(pool, shift);
    if (ids.length) {
      const others = ids.filter((id) => id !== user.user_id);
      const { rows } = await pool.query(
        `SELECT user_id, staff_number, full_name FROM app_user
          WHERE user_id = ANY($1::uuid[]) AND is_active ORDER BY full_name`,
        [others],
      );
      return {
        current_shift: shift,
        template,
        incoming_staff: rows,
        roster_based_incoming: true,
        suggested_incoming_user_id: others.length === 1 ? others[0] : null,
      };
    }
  }
  const incoming = await fixedRoleIncoming(user.department_id);
  return { current_shift: shift, template, incoming_staff: incoming.rows };
}

async function create(user, body) {
  return withTransaction(async (client) => {
    const shift = await findCurrentShift(client, user.department_id);
    if (!shift) throw new AppError(409, 'No shift is currently active for your department');

    // Phase 3: with roster duty on and a rostered current shift, only the
    // people assigned to it may author its handover; without a roster,
    // today's rule (role outgoing_staff) applies exactly.
    const duty = await canAuthorShift(client, user, shift);
    if (!duty.ok) {
      throw new AppError(403, duty.rostered === false
        ? 'You are not on the roster for the current shift'
        : 'Only outgoing staff may create a handover record');
    }
    const template = await loadTemplate(client, user.department_id);

    // Preselect the incoming person from the next shift's roster when it
    // names exactly one; with several, the author picks from that roster.
    let incomingUserId = body.incoming_user_id || null;
    if (!incomingUserId && rosterDutyEnabled()) {
      const others = (await incomingRoster(client, shift)).ids.filter((id) => id !== user.user_id);
      if (others.length === 1) [incomingUserId] = others;
    }
    await assertValidIncoming(client, user.department_id, incomingUserId, shift, user.user_id);

    let record;
    try {
      ({ rows: [record] } = await client.query(
        `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [shift.shift_id, user.department_id, user.user_id, incomingUserId, body.summary_notes ?? null],
      ));
    } catch (err) {
      if (err.constraint === 'handover_record_one_open_per_shift') {
        throw new AppError(409, 'An open handover record already exists for this department and shift');
      }
      throw err;
    }

    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: record.record_id,
      action: 'create', newValue: { ...auditView(record), shift_id: shift.shift_id, template_version: template.version },
    });
    return { ...(await fetchDetail(client, record.record_id)), template };
  });
}

async function update(user, recordId, body) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertOutgoingOwner(user, record);
    assertDraft(record);

    const next = { ...record };
    if ('summary_notes' in body) next.summary_notes = body.summary_notes;
    if ('incoming_user_id' in body) {
      if (rosterDutyEnabled()) {
        const { rows: [shift] } = await client.query('SELECT * FROM shift WHERE shift_id = $1', [record.shift_id]);
        await assertValidIncoming(client, record.department_id, body.incoming_user_id, shift, record.outgoing_user_id);
      } else {
        await assertValidIncoming(client, record.department_id, body.incoming_user_id); // exactly as on main
      }
      next.incoming_user_id = body.incoming_user_id;
    }

    // WHERE status = 'draft' is a second guard alongside the trigger.
    const { rows: [updated] } = await client.query(
      `UPDATE handover_record SET summary_notes = $2, incoming_user_id = $3
        WHERE record_id = $1 AND status = 'draft' RETURNING *`,
      [recordId, next.summary_notes, next.incoming_user_id],
    );
    if (!updated) throw new AppError(409, 'Handover record is no longer a draft and is locked against edits');
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId,
      action: 'update', previousValue: auditView(record), newValue: auditView(updated),
    });
    return fetchDetail(client, recordId);
  });
}

async function addTask(user, recordId, body) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertOutgoingOwner(user, record);
    assertDraft(record);

    const { rows: [task] } = await client.query(
      `INSERT INTO task (record_id, description, status, priority)
       VALUES ($1, $2, COALESCE($3, 'open')::task_status_enum, COALESCE($4, 'medium')::priority_enum) RETURNING *`,
      [recordId, body.description, body.status || null, body.priority || null],
    );
    await writeAudit(client, {
      userId: user.user_id, entityType: 'task', entityId: task.task_id, action: 'create', newValue: task,
    });
    return task;
  });
}

async function updateTask(user, recordId, taskId, body) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertOutgoingOwner(user, record);
    assertDraft(record);

    const { rows: [task] } = await client.query(
      'SELECT * FROM task WHERE task_id = $1 AND record_id = $2',
      [taskId, recordId],
    );
    if (!task) throw new AppError(404, 'Task not found on this record');

    const { rows: [updated] } = await client.query(
      `UPDATE task SET description = $2, status = $3, priority = $4 WHERE task_id = $1 RETURNING *`,
      [taskId, body.description ?? task.description, body.status ?? task.status, body.priority ?? task.priority],
    );
    await writeAudit(client, {
      userId: user.user_id, entityType: 'task', entityId: taskId, action: 'update', previousValue: task, newValue: updated,
    });
    return updated;
  });
}

async function addIncident(user, recordId, body) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertOutgoingOwner(user, record);
    assertDraft(record);

    const { rows: [incident] } = await client.query(
      `INSERT INTO incident (record_id, title, description, severity, occurred_at, reported_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [recordId, body.title, body.description || null, body.severity, body.occurred_at, user.user_id],
    );
    await writeAudit(client, {
      userId: user.user_id, entityType: 'incident', entityId: incident.incident_id, action: 'create', newValue: incident,
    });
    return incident;
  });
}

/**
 * Carry-forward: copies every 'open'/'in_progress' task from the department's
 * most recent earlier non-closed (and non-draft) record onto `record`, linking
 * each copy via carried_from_task_id. Tasks that were already carried forward
 * once are skipped, so a task is never duplicated onto two later records.
 * Must run while `record` is still a draft (task inserts are frozen after).
 */
async function carryForwardTasks(client, user, record) {
  const { rows: [source] } = await client.query(
    `SELECT r.record_id
       FROM handover_record r
       JOIN shift s ON s.shift_id = r.shift_id
      WHERE r.department_id = $1
        AND r.record_id <> $2
        AND r.status NOT IN ('draft', 'closed')
        AND s.start_time < (SELECT start_time FROM shift WHERE shift_id = $3)
      ORDER BY s.start_time DESC, r.created_at DESC
      LIMIT 1`,
    [record.department_id, record.record_id, record.shift_id],
  );
  if (!source) return { source_record_id: null, tasks: [] };

  const { rows: carried } = await client.query(
    `INSERT INTO task (record_id, description, status, priority, carried_from_task_id)
     SELECT $1, t.description, t.status, t.priority, t.task_id
       FROM task t
      WHERE t.record_id = $2
        AND t.status IN ('open', 'in_progress')
        AND NOT EXISTS (SELECT 1 FROM task c WHERE c.carried_from_task_id = t.task_id)
      ORDER BY t.created_at
     RETURNING *`,
    [record.record_id, source.record_id],
  );
  for (const task of carried) {
    await writeAudit(client, {
      userId: user.user_id, entityType: 'task', entityId: task.task_id, action: 'carry_forward',
      previousValue: { task_id: task.carried_from_task_id, record_id: source.record_id }, newValue: task,
    });
  }
  return { source_record_id: source.record_id, tasks: carried };
}

async function submit(user, recordId) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertOutgoingOwner(user, record);
    assertDraft(record);

    // 1. Server-side validation against the department's current template.
    const template = await loadTemplate(client, record.department_id);
    const [{ rows: tasks }, { rows: incidents }] = await Promise.all([
      client.query('SELECT task_id FROM task WHERE record_id = $1', [recordId]),
      client.query('SELECT incident_id FROM incident WHERE record_id = $1', [recordId]),
    ]);
    const missing = findMissingFields(template.field_definition, {
      summary_notes: record.summary_notes, tasks, incidents,
    });
    // Always required regardless of template: someone must receive the handover.
    if (!record.incoming_user_id) {
      missing.unshift({ field: 'incoming_user_id', label: 'Incoming staff member', reason: 'required' });
    }
    if (missing.length) {
      throw new AppError(422, `Submission rejected: missing ${missing.map((m) => m.field).join(', ')}`, {
        missing_fields: missing, template_version: template.version,
      });
    }

    // 2. Carry forward unresolved tasks while the record is still a draft.
    const carry = await carryForwardTasks(client, user, record);

    // 3. Lock the record.
    const { rows: [submitted] } = await client.query(
      `UPDATE handover_record SET status = 'submitted', submitted_at = now()
        WHERE record_id = $1 AND status = 'draft' RETURNING *`,
      [recordId],
    );
    if (!submitted) throw new AppError(409, 'Handover record is no longer a draft and is locked against edits');
    // Part M: running timers on this record's tasks stop at submission.
    await stopTimersForRecord(client, recordId, submitted.submitted_at);
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'submit',
      previousValue: auditView(record),
      newValue: {
        ...auditView(submitted),
        template_id: template.template_id,
        template_version: template.version,
        carried_from_record_id: carry.source_record_id,
        carried_task_ids: carry.tasks.map((t) => t.task_id),
      },
    });

    // 4. Phase 2: evaluate for automatic release (held on any failure).
    // Required lazily: release.service requires this module back.
    const { applyReleaseOnSubmit } = require('./release.service'); // eslint-disable-line global-require
    const release = await applyReleaseOnSubmit(client, user, submitted);

    // 5. Notify. The incoming person always receives the report at once, held
    // or not (a hold never blocks the next shift). Supervisors get a
    // 'handover_held' alert instead of the plain submission notice when the
    // report needs their approval — one notification each, never both.
    const supervisorIds = await departmentSupervisorIds(client, record.department_id);
    const notified = [
      ...await notifyRecord(client, [submitted.incoming_user_id], recordId, 'handover_submitted'),
      ...await notifyRecord(client, supervisorIds, recordId, release.hold ? 'handover_held' : 'handover_submitted'),
    ];

    return { ...(await fetchDetail(client, recordId)), carried_forward: carry.tasks.length, notified };
  });
}

module.exports = {
  // shared with other modules
  RECORD_SELECT, auditView, lockRecord, assertStatus, assertOutgoingOwner, fetchRecord, fetchDetail,
  loadTemplate, notifyRecord, departmentSupervisorIds,
  // phase 3
  list, meta, create, update, addTask, updateTask, addIncident, submit,
};

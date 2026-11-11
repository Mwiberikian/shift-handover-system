// Phase 2: automatic release of handover reports, with holds.
//
// Runs inside submit()'s transaction: once a record is submitted it is either
// AUTO-RELEASED (no hold rule fired) or HELD for supervisor approval. A held
// report never blocks the next shift — the incoming person still receives,
// reads and acknowledges it through the existing flow; only the "checks
// passed" stamp is withheld until a supervisor approves.
//
// FAIL SAFE: if the auto-approval flag is off, the assistant is disabled, or
// the evaluation itself throws, the report is HELD, never silently released.
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const { assertDepartmentAccess } = require('../../middleware/auth');
const { autoApprovalEnabled } = require('../../config/flags');
const { evaluateRelease } = require('../assistant/release');
const {
  auditView, lockRecord, assertStatus, fetchDetail, notifyRecord,
} = require('./handovers.service');

const assistantEnabled = () => process.env.ASSISTANT_ENABLED !== 'false';

// Keeps release_reasons under its 1 KB database cap whatever the content.
const trimReasons = (reasons) => reasons.slice(0, 8).map((r) => ({
  ...r, text: String(r.text || '').slice(0, 100),
}));

// Decides for a just-submitted record. Never throws: any failure is a hold.
function decideRelease({ summary, tasks, incidents }) {
  if (!autoApprovalEnabled()) {
    return { hold: true, reasons: [{ code: 'auto_approval_disabled', text: 'automatic release is switched off' }] };
  }
  if (!assistantEnabled()) {
    return { hold: true, reasons: [{ code: 'assistant_disabled', text: 'the assistant is switched off, so the report was not evaluated' }] };
  }
  try {
    return evaluateRelease({ summary, tasks, incidents });
  } catch (err) {
    return { hold: true, reasons: [{ code: 'evaluation_failed', text: 'the automatic check failed, so the report is held for approval' }] };
  }
}

// Called by submit() with its transaction client, after the record has moved
// to 'submitted'. Writes the decision onto the record plus one audit entry
// (actor: the submitting user; new_value says the assistant decided and why).
// Returns the decision so submit() can notify supervisors accordingly.
async function applyReleaseOnSubmit(client, user, record) {
  const [tasks, incidents] = await Promise.all([
    client.query('SELECT description FROM task WHERE record_id = $1', [record.record_id]),
    client.query('SELECT title, description, severity FROM incident WHERE record_id = $1', [record.record_id]),
  ]);
  const decision = decideRelease({
    summary: record.summary_notes, tasks: tasks.rows, incidents: incidents.rows,
  });
  const state = decision.hold ? 'held' : 'auto_released';
  const reasons = trimReasons(decision.reasons);

  const { rows: [updated] } = await client.query(
    `UPDATE handover_record
        SET release_state = $2::varchar, released_at = CASE WHEN $2::varchar = 'auto_released' THEN now() END, release_reasons = $3
      WHERE record_id = $1 RETURNING *`,
    [record.record_id, state, JSON.stringify(reasons)],
  );
  await writeAudit(client, {
    userId: user.user_id, entityType: 'handover_record', entityId: record.record_id,
    action: decision.hold ? 'hold' : 'auto_release',
    previousValue: auditView(record),
    newValue: {
      ...auditView(updated), by: 'assistant', release_state: state, reasons,
    },
  });
  return { ...decision, release_state: state, record: updated };
}

// POST /api/handovers/:id/approve — a supervisor (own department) or admin
// releases a held report. Always available, whatever the flag says.
async function approve(user, recordId, { comments } = {}) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertDepartmentAccess(user, record.department_id);
    if (record.release_state !== 'held') {
      throw new AppError(409, `This report is not held for approval (release state: ${record.release_state || 'none'})`, {
        record_id: recordId, release_state: record.release_state,
      });
    }
    if (record.status === 'closed') throw new AppError(409, 'This handover record is closed');

    const { rows: [updated] } = await client.query(
      `UPDATE handover_record SET release_state = 'approved', released_at = now() WHERE record_id = $1 RETURNING *`,
      [recordId],
    );
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'approve_release',
      previousValue: { ...auditView(record), release_state: record.release_state },
      newValue: {
        ...auditView(updated), release_state: 'approved', approved_by: user.user_id, approved_at: updated.released_at, comments: comments || null,
      },
    });
    // Approvals are in-app only, like handover_acknowledged/handover_closed.
    await notifyRecord(client, [record.incoming_user_id, record.outgoing_user_id], recordId, 'handover_approved');
    return fetchDetail(client, recordId);
  });
}

// POST /api/handovers/:id/send-back — a supervisor returns a held report to
// the outgoing author with a note, through the existing 'queried' flow (the
// author answers with the existing clarify action; the report stays held
// until a supervisor approves it).
async function sendBack(user, recordId, { comments }) {
  return withTransaction(async (client) => {
    const record = await lockRecord(client, recordId);
    assertDepartmentAccess(user, record.department_id);
    if (record.release_state !== 'held') {
      throw new AppError(409, `This report is not held for approval (release state: ${record.release_state || 'none'})`, {
        record_id: recordId, release_state: record.release_state,
      });
    }
    assertStatus(record, 'submitted');

    const { rows: [updated] } = await client.query(
      `UPDATE handover_record SET status = 'queried' WHERE record_id = $1 RETURNING *`,
      [recordId],
    );
    await writeAudit(client, {
      userId: user.user_id, entityType: 'handover_record', entityId: recordId, action: 'query',
      previousValue: auditView(record), newValue: { ...auditView(updated), comments, sent_back_by_supervisor: true },
    });
    await notifyRecord(client, [record.outgoing_user_id], recordId, 'handover_queried');
    return fetchDetail(client, recordId);
  });
}

module.exports = { decideRelease, applyReleaseOnSubmit, approve, sendBack };

// Handover assistant (Part S): database access around the pure functions in
// this folder. Every endpoint is advisory. Nothing here changes a handover.
//
// Visibility follows the existing rules (FR-03, NFR-07):
//   - outgoing staff: their own drafts and records only; text from other
//     people's handovers is never returned to them (only counts and dates);
//   - supervisors: their own department; admins: any department;
//   - incoming staff: no assistant endpoints.
const pool = require('../../config/db');
const AppError = require('../../utils/AppError');
const { assertDepartmentAccess } = require('../../middleware/auth');
const { checkHandover } = require('./quality');
const { findRecurring, clusterRecurring } = require('./recurring');
const severity = require('./severity');
const { scoreRecord } = require('./ranking');
const { suggestTasks } = require('./suggest');
const { rankDocuments } = require('./search');
const { buildDigest } = require('./digest');
const {
  RECURRING, SEARCH, SEVERITY, RANKING, SUGGEST, EVENT_KINDS,
} = require('./constants');

const enabled = () => process.env.ASSISTANT_ENABLED !== 'false';
const DAY = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// shared queries
// ---------------------------------------------------------------------------

// Number of earlier shifts a task has already been carried over, per task id.
async function carryDepths(db, taskIds) {
  if (!taskIds.length) return new Map();
  const { rows } = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT task_id AS leaf, carried_from_task_id AS parent, 0 AS depth FROM task WHERE task_id = ANY($1::uuid[])
       UNION ALL
       SELECT c.leaf, t.carried_from_task_id, c.depth + 1 FROM chain c JOIN task t ON t.task_id = c.parent
     )
     SELECT leaf, MAX(depth) AS depth FROM chain GROUP BY leaf`,
    [taskIds],
  );
  return new Map(rows.map((r) => [r.leaf, Number(r.depth)]));
}

async function ownRecord(user, recordId) {
  const { rows: [rec] } = await pool.query(
    `SELECT r.*, s.start_time AS shift_start, s.shift_type FROM handover_record r JOIN shift s USING (shift_id) WHERE r.record_id = $1`,
    [recordId],
  );
  if (!rec) throw new AppError(404, 'Handover record not found');
  if (user.role === 'outgoing_staff') {
    if (rec.outgoing_user_id !== user.user_id) throw new AppError(403, 'This is not your handover record');
  } else {
    assertDepartmentAccess(user, rec.department_id);
  }
  return rec;
}

async function recordContent(db, recordId) {
  const [tasks, incidents] = await Promise.all([
    db.query('SELECT task_id, description, priority, status FROM task WHERE record_id = $1 ORDER BY created_at, task_id', [recordId]),
    db.query('SELECT incident_id, title, description, severity FROM incident WHERE record_id = $1 ORDER BY occurred_at', [recordId]),
  ]);
  return { tasks: tasks.rows, incidents: incidents.rows };
}

// Items of other submitted handovers of the department in the last N days.
async function departmentHistory(db, departmentId, { days, excludeRecordId = null, authorId = null }) {
  const since = new Date(Date.now() - days * DAY);
  const { rows } = await db.query(
    `SELECT * FROM (
       SELECT t.task_id::text AS id, 'task' AS kind, t.record_id, t.description AS text, t.priority::text AS priority,
              s.start_time AS shift_start, s.shift_type, r.outgoing_user_id
         FROM task t JOIN handover_record r ON r.record_id = t.record_id JOIN shift s ON s.shift_id = r.shift_id
        WHERE r.department_id = $1 AND r.status <> 'draft' AND s.start_time >= $2
       UNION ALL
       SELECT i.incident_id::text, 'incident', i.record_id, trim(i.title || ' ' || COALESCE(i.description, '')), NULL,
              s.start_time, s.shift_type, r.outgoing_user_id
         FROM incident i JOIN handover_record r ON r.record_id = i.record_id JOIN shift s ON s.shift_id = r.shift_id
        WHERE r.department_id = $1 AND r.status <> 'draft' AND s.start_time >= $2
     ) h
     WHERE ($3::uuid IS NULL OR h.record_id <> $3) AND ($4::uuid IS NULL OR h.outgoing_user_id = $4)
     ORDER BY shift_start DESC LIMIT $5`,
    [departmentId, since, excludeRecordId, authorId, RECURRING.maxItems],
  );
  return rows;
}

function scopeDepartment(user, requested) {
  if (requested) assertDepartmentAccess(user, requested);
  if (user.role === 'admin') return requested || null;
  return user.department_id;
}

// ---------------------------------------------------------------------------
// 1. quality check
// ---------------------------------------------------------------------------

async function qualityFor(db, rec, content) {
  const depths = await carryDepths(db, content.tasks.map((t) => t.task_id));
  const staleTasks = content.tasks
    .filter((t) => t.status !== 'resolved' && (depths.get(t.task_id) || 0) >= 1)
    .map((t) => ({ description: t.description, carry_depth: depths.get(t.task_id) }));
  return checkHandover({
    summary: rec.summary_notes, tasks: content.tasks, incidents: content.incidents, staleTasks,
  });
}

async function check(user, recordId) {
  const rec = await ownRecord(user, recordId);
  const content = await recordContent(pool, recordId);
  return { record_id: recordId, ...(await qualityFor(pool, rec, content)) };
}

// ---------------------------------------------------------------------------
// 2. recurring issues
// ---------------------------------------------------------------------------

async function recurringForRecord(user, recordId) {
  const rec = await ownRecord(user, recordId);
  const content = await recordContent(pool, recordId);
  const items = [
    ...content.tasks.map((t) => ({ id: t.task_id, kind: 'task', text: t.description })),
    ...content.incidents.map((i) => ({ id: i.incident_id, kind: 'incident', text: `${i.title} ${i.description || ''}`.trim() })),
  ];
  const history = await departmentHistory(pool, rec.department_id, { days: RECURRING.historyDays, excludeRecordId: recordId });
  const found = findRecurring(items, history);
  const mine = new Set(history.filter((h) => h.outgoing_user_id === user.user_id).map((h) => h.record_id));
  const sees = (recId) => user.role !== 'outgoing_staff' || mine.has(recId);
  return {
    record_id: recordId,
    window_days: RECURRING.historyDays,
    recurring: found.map((f) => ({
      ...f,
      // Text of other people's handovers is not shown to outgoing staff (FR-03).
      matches: f.matches.map((m) => (sees(m.record_id) ? m : { ...m, text: null, hidden: true })),
    })),
  };
}

async function recurringForDepartments(user, query) {
  const dept = scopeDepartment(user, query.department_id);
  const days = Math.min(Number(query.days) || RECURRING.historyDays, 180);
  const depts = dept ? [dept] : (await pool.query('SELECT department_id FROM department ORDER BY name')).rows.map((r) => r.department_id);
  const out = [];
  for (const d of depts) {
    const history = await departmentHistory(pool, d, { days });
    const { rows: [info] } = await pool.query('SELECT name FROM department WHERE department_id = $1', [d]);
    clusterRecurring(history).forEach((c) => out.push({ department_id: d, department_name: info?.name, ...c }));
  }
  return { window_days: days, clusters: out.sort((a, b) => b.occurrences - a.occurrences) };
}

// ---------------------------------------------------------------------------
// 3. attention ranking
// ---------------------------------------------------------------------------

async function attention(user, query) {
  const dept = scopeDepartment(user, query.department_id);
  const { rows: records } = await pool.query(
    `SELECT r.record_id, r.status, r.summary_notes, r.submitted_at, r.department_id, d.name AS department_name,
            s.shift_type, s.start_time AS shift_start, s.end_time AS shift_end, o.full_name AS outgoing_name
       FROM handover_record r
       JOIN shift s ON s.shift_id = r.shift_id
       JOIN department d ON d.department_id = r.department_id
       LEFT JOIN app_user o ON o.user_id = r.outgoing_user_id
      WHERE r.status NOT IN ('draft', 'closed') AND ($1::uuid IS NULL OR r.department_id = $1)
      ORDER BY s.start_time DESC LIMIT 200`,
    [dept],
  );
  if (!records.length) return { items: [] };
  const ids = records.map((r) => r.record_id);
  const [tasks, incidents] = await Promise.all([
    pool.query('SELECT task_id, record_id, description, priority, status FROM task WHERE record_id = ANY($1::uuid[])', [ids]),
    pool.query('SELECT record_id, title, description, severity FROM incident WHERE record_id = ANY($1::uuid[])', [ids]),
  ]);
  const depths = await carryDepths(pool, tasks.rows.map((t) => t.task_id));
  const by = (rows) => rows.reduce((m, r) => { (m.get(r.record_id) || m.set(r.record_id, []).get(r.record_id)).push(r); return m; }, new Map());
  const tByRec = by(tasks.rows); const iByRec = by(incidents.rows);
  const now = Date.now();
  const items = records.map((r) => {
    const ts = tByRec.get(r.record_id) || []; const is = iByRec.get(r.record_id) || [];
    const stale = ts.filter((t) => t.status !== 'resolved').map((t) => ({ description: t.description, carry_depth: depths.get(t.task_id) || 0 })).filter((t) => t.carry_depth >= 1);
    const q = checkHandover({
      summary: r.summary_notes, tasks: ts, incidents: is, staleTasks: stale,
    });
    const sinceMs = now - new Date(r.shift_end).getTime(); // acknowledgement is due once the incoming shift starts
    const s = scoreRecord({
      status: r.status,
      hours_since_submit: sinceMs / 3600000,
      incidents: is,
      open_tasks: ts.filter((t) => t.status !== 'resolved').map((t) => ({ priority: t.priority, carry_depth: depths.get(t.task_id) || 0 })),
      quality_counts: q.counts,
    });
    return {
      record_id: r.record_id,
      department_id: r.department_id,
      department_name: r.department_name,
      shift_type: r.shift_type,
      shift_start: r.shift_start,
      status: r.status,
      outgoing_name: r.outgoing_name,
      ...s,
      flags: q.flags.slice(0, 3).map((f) => ({ code: f.code, level: f.level, message: f.message })),
    };
  }).filter((i) => i.score > 0).sort((a, b) => b.score - a.score || new Date(b.shift_start) - new Date(a.shift_start));
  return { items: items.slice(0, Math.min(Number(query.limit) || RANKING.maxItems, RANKING.maxItems)) };
}

// ---------------------------------------------------------------------------
// 4. search by meaning
// ---------------------------------------------------------------------------

async function search(user, query) {
  const dept = scopeDepartment(user, query.department_id);
  const since = new Date(Date.now() - SEARCH.corpusDays * DAY);
  const { rows: records } = await pool.query(
    `SELECT r.record_id, r.status, r.summary_notes, r.department_id, d.name AS department_name,
            s.shift_type, s.start_time AS shift_start
       FROM handover_record r JOIN shift s USING (shift_id) JOIN department d ON d.department_id = r.department_id
      WHERE r.status <> 'draft' AND s.start_time >= $2 AND ($1::uuid IS NULL OR r.department_id = $1)
      ORDER BY s.start_time DESC LIMIT $3`,
    [dept, since, SEARCH.maxRecords],
  );
  if (!records.length) return { query: query.q, results: [] };
  const ids = records.map((r) => r.record_id);
  const [tasks, incidents] = await Promise.all([
    pool.query('SELECT record_id, description FROM task WHERE record_id = ANY($1::uuid[])', [ids]),
    pool.query('SELECT record_id, title, description FROM incident WHERE record_id = ANY($1::uuid[])', [ids]),
  ]);
  const parts = new Map(records.map((r) => [r.record_id, r.summary_notes ? [{ kind: 'summary', text: r.summary_notes }] : []]));
  tasks.rows.forEach((t) => parts.get(t.record_id).push({ kind: 'task', text: t.description }));
  incidents.rows.forEach((i) => parts.get(i.record_id).push({ kind: 'incident', text: `${i.title}. ${i.description || ''}`.trim() }));
  const docs = records.filter((r) => parts.get(r.record_id).length).map((r) => ({
    record_id: r.record_id, department_id: r.department_id, department_name: r.department_name, shift_type: r.shift_type, shift_start: r.shift_start, status: r.status, parts: parts.get(r.record_id),
  }));
  const limit = Math.min(Number(query.limit) || SEARCH.limit, 50);
  return { query: query.q, results: rankDocuments(query.q, docs, { limit }) };
}

// ---------------------------------------------------------------------------
// 5. suggested tasks (own history only)
// ---------------------------------------------------------------------------

async function suggestions(user, recordId) {
  const rec = await ownRecord(user, recordId);
  if (user.role !== 'outgoing_staff') throw new AppError(403, 'Suggestions are for the outgoing author of a draft');
  const { rows: history } = await pool.query(
    `SELECT t.record_id, t.description, t.priority::text AS priority, s.start_time AS shift_start
       FROM task t JOIN handover_record r ON r.record_id = t.record_id JOIN shift s ON s.shift_id = r.shift_id
      WHERE r.outgoing_user_id = $1 AND r.status <> 'draft' AND s.shift_type = $2 AND r.record_id <> $3
        AND r.record_id IN (
          SELECT r2.record_id FROM handover_record r2 JOIN shift s2 ON s2.shift_id = r2.shift_id
           WHERE r2.outgoing_user_id = $1 AND r2.status <> 'draft' AND s2.shift_type = $2 AND r2.record_id <> $3
           ORDER BY s2.start_time DESC LIMIT $4)`,
    [user.user_id, rec.shift_type, recordId, SUGGEST.recordsConsidered],
  );
  const content = await recordContent(pool, recordId);
  return { record_id: recordId, suggestions: suggestTasks(content.tasks, history) };
}

// ---------------------------------------------------------------------------
// 6. severity suggestion (trained on the department's own incidents)
// ---------------------------------------------------------------------------

const modelCache = new Map(); // department_id -> { at, examples }
const CACHE_MS = 5 * 60 * 1000;
const clearCache = () => modelCache.clear();

async function incidentExamples(departmentId) {
  const hit = modelCache.get(departmentId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.examples;
  const since = new Date(Date.now() - SEVERITY.trainingDays * DAY);
  const { rows } = await pool.query(
    `SELECT trim(i.title || ' ' || COALESCE(i.description, '')) AS text, i.severity::text AS severity
       FROM incident i JOIN handover_record r ON r.record_id = i.record_id
      WHERE r.department_id = $1 AND r.status <> 'draft' AND i.occurred_at >= $2`,
    [departmentId, since],
  );
  modelCache.set(departmentId, { at: Date.now(), examples: rows });
  return rows;
}

async function suggestSeverity(user, { title, description }) {
  if (user.role !== 'outgoing_staff') throw new AppError(403, 'Severity suggestions are for outgoing staff');
  const examples = await incidentExamples(user.department_id);
  const s = severity.suggest(examples, `${title} ${description || ''}`);
  // Only the aggregate result leaves the server, never another person's text.
  return s;
}

async function severityEvaluation(user, query) {
  const dept = scopeDepartment(user, query.department_id);
  if (!dept) throw new AppError(400, 'department_id is required');
  const examples = await incidentExamples(dept);
  return { ...severity.crossValidate(examples, 5), examples: examples.length };
}

// ---------------------------------------------------------------------------
// 7. end-of-shift digest
// ---------------------------------------------------------------------------

async function digestInput(db, shiftId) {
  const { rows: [shift] } = await db.query(
    `SELECT s.*, d.name AS department_name FROM shift s JOIN department d USING (department_id) WHERE s.shift_id = $1`,
    [shiftId],
  );
  if (!shift) throw new AppError(404, 'Shift not found');
  const { rows: records } = await db.query(
    `SELECT record_id, status, summary_notes, submitted_at, department_id FROM handover_record WHERE shift_id = $1 AND status <> 'draft'`,
    [shiftId],
  );
  const ids = records.map((r) => r.record_id);
  const [tasks, incidents] = ids.length ? await Promise.all([
    db.query('SELECT task_id, record_id, description, priority, status FROM task WHERE record_id = ANY($1::uuid[])', [ids]),
    db.query('SELECT record_id, title, description, severity FROM incident WHERE record_id = ANY($1::uuid[])', [ids]),
  ]) : [{ rows: [] }, { rows: [] }];
  const depths = await carryDepths(db, tasks.rows.map((t) => t.task_id));
  const sevCount = { critical: 0, high: 0, medium: 0, low: 0 };
  incidents.rows.forEach((i) => { sevCount[i.severity] += 1; });
  const open = tasks.rows.filter((t) => t.status !== 'resolved');
  const acknowledgedStates = ['acknowledged', 'under_review', 'escalated', 'closed'];
  const counts = {
    submitted: records.length,
    acknowledged: records.filter((r) => acknowledgedStates.includes(r.status)).length,
    unacknowledged: records.filter((r) => ['submitted', 'queried'].includes(r.status)).length,
    closed: records.filter((r) => r.status === 'closed').length,
    escalated: records.filter((r) => r.status === 'escalated').length,
    no_handover: records.length === 0,
  };
  // Ranking for this shift's records only.
  const items = records.filter((r) => r.status !== 'closed').map((r) => {
    const ts = tasks.rows.filter((t) => t.record_id === r.record_id); const is = incidents.rows.filter((i) => i.record_id === r.record_id);
    const q = checkHandover({
      summary: r.summary_notes, tasks: ts, incidents: is, staleTasks: ts.filter((t) => t.status !== 'resolved').map((t) => ({ description: t.description, carry_depth: depths.get(t.task_id) || 0 })),
    });
    return {
      record_id: r.record_id,
      ...scoreRecord({
        status: r.status,
        hours_since_submit: (Date.now() - new Date(shift.end_time).getTime()) / 3600000,
        incidents: is,
        open_tasks: ts.filter((t) => t.status !== 'resolved').map((t) => ({ priority: t.priority, carry_depth: depths.get(t.task_id) || 0 })),
        quality_counts: q.counts,
      }),
    };
  }).filter((i) => i.score >= RANKING.medium).sort((a, b) => b.score - a.score);
  const history = await departmentHistory(db, shift.department_id, { days: RECURRING.historyDays });
  const clusters = clusterRecurring(history);
  return {
    department_id: shift.department_id,
    shift_id: shiftId,
    department_name: shift.department_name,
    shift_type: shift.shift_type,
    shift_end: shift.end_time,
    counts,
    incidents: sevCount,
    open_high_tasks: open.filter((t) => t.priority === 'high').length,
    stale_tasks: open.filter((t) => (depths.get(t.task_id) || 0) >= 3).length,
    attention: items,
    recurring: clusters.slice(0, 3),
  };
}

async function digest(user, query) {
  const dept = scopeDepartment(user, query.department_id);
  let shiftId = query.shift_id;
  if (shiftId) {
    const { rows: [s] } = await pool.query('SELECT department_id FROM shift WHERE shift_id = $1', [shiftId]);
    if (!s) throw new AppError(404, 'Shift not found');
    assertDepartmentAccess(user, s.department_id);
  } else {
    if (!dept) throw new AppError(400, 'department_id is required');
    const { rows: [s] } = await pool.query(
      'SELECT shift_id FROM shift WHERE department_id = $1 AND end_time <= now() ORDER BY end_time DESC LIMIT 1',
      [dept],
    );
    if (!s) throw new AppError(404, 'No shift has ended yet for this department');
    shiftId = s.shift_id;
  }
  const input = await digestInput(pool, shiftId);
  return { shift_id: shiftId, ...buildDigest(input), data: { counts: input.counts, incidents: input.incidents } };
}

// ---------------------------------------------------------------------------
// events and usage statistics
// ---------------------------------------------------------------------------

function cleanPayload(payload) {
  const out = {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    Object.entries(payload).slice(0, 12).forEach(([k, v]) => {
      if (['string', 'number', 'boolean'].includes(typeof v)) out[String(k).slice(0, 30)] = typeof v === 'string' ? v.slice(0, 60) : v;
    });
  }
  return out;
}

async function logEvent(user, { kind, record_id: recordId, payload }) {
  if (!EVENT_KINDS.includes(kind)) throw new AppError(400, `Unknown event kind '${kind}'`);
  if (recordId) await ownRecord(user, recordId);
  await pool.query(
    'INSERT INTO assistant_event (user_id, record_id, kind, payload) VALUES ($1, $2, $3, $4)',
    [user.user_id, recordId || null, kind, JSON.stringify(cleanPayload(payload))],
  );
  return { ok: true };
}

async function stats(user, query) {
  const dept = scopeDepartment(user, query.department_id);
  const days = Math.min(Number(query.days) || 90, 365);
  const { rows } = await pool.query(
    `SELECT e.kind, count(*)::int AS n
       FROM assistant_event e JOIN app_user u ON u.user_id = e.user_id
      WHERE e.created_at >= now() - make_interval(days => $2) AND ($1::uuid IS NULL OR u.department_id = $1)
      GROUP BY e.kind`,
    [dept, days],
  );
  const n = Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  const rate = (a, b) => (n[a] || n[b] ? Math.round(((n[a] || 0) / ((n[a] || 0) + (n[b] || 0))) * 1000) / 1000 : null);
  return {
    window_days: days,
    counts: n,
    suggestion_acceptance: rate('suggestion_accepted', 'suggestion_dismissed'),
    severity_acceptance: rate('severity_accepted', 'severity_overridden'),
    flag_dismissal: n.flags_shown ? Math.round(((n.flag_dismissed || 0) / n.flags_shown) * 1000) / 1000 : null,
  };
}

module.exports = {
  enabled,
  check,
  recurringForRecord,
  recurringForDepartments,
  attention,
  search,
  suggestions,
  suggestSeverity,
  severityEvaluation,
  digest,
  digestInput,
  logEvent,
  stats,
  clearCache,
  carryDepths,
};

// Handover quality check (advisory). Rule-based and explainable: every flag
// has a stable code, a level and a plain message, and none of them blocks a
// submission. The author decides. A flag that is shown and then dismissed is
// logged (assistant_event) so false alarms can be counted.
//
//   checkHandover({ summary, tasks, incidents, staleTasks }) -> { flags, counts, ready }
//
// tasks:      [{ description, priority, status }]
// incidents:  [{ title, description, severity }]
// staleTasks: [{ description, carry_depth }]  (supplied by the service)
const { tokenize, sharedTokens } = require('./text');
const { QUALITY } = require('./constants');

const FILLER = /^\s*(all\s+(ok|okay|good|fine|normal|clear)|nothing(\s+to\s+report)?|n\/?a|as\s+usual|same\s+as\s+(yesterday|before|last\s+shift)|no\s+issues?|normal\s+operations?)\W*$/i;
const SERIOUS = new Set(['high', 'critical']);
// Places and numbers say where, not what. Two texts that only share "stand 4"
// are not about the same thing, so these do not count as a link between an
// incident and a task or between an incident and the summary.
const LOCATION = new Set(['stand', 'gate', 'bay', 'terminal', 'apron', 'hangar', 'door', 'area', 'near', 'side']);
const what = (tokens) => tokens.filter((t) => !LOCATION.has(t) && !/^\d+$/.test(t) && !/^\d/.test(t));

function jaccard(a, b) {
  const sa = new Set(a); const sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function flag(code, level, message, extra = {}) {
  return { code, level, message, ...extra };
}

function checkHandover({
  summary = '', tasks = [], incidents = [], staleTasks = [],
} = {}) {
  const flags = [];
  const text = String(summary || '').trim();
  const serious = incidents.filter((i) => SERIOUS.has(i.severity));

  // Summary
  if (!text) {
    flags.push(flag('summary_missing', 'high', 'The shift summary is empty.', { field: 'summary' }));
  } else if (FILLER.test(text)) {
    flags.push(incidents.length
      ? flag('summary_contradicts_incidents', 'high', `The summary says there was nothing to report, but ${incidents.length} incident${incidents.length > 1 ? 's were' : ' was'} recorded.`, { field: 'summary' })
      : flag('summary_filler', 'low', 'The summary only says nothing happened. Say what was checked or handled so the next shift can rely on it.', { field: 'summary' }));
  } else if (text.length < QUALITY.minSummaryChars) {
    flags.push(flag('summary_short', 'medium', `The summary is very short (${text.length} characters). Add what the next shift needs to know.`, { field: 'summary' }));
  }

  // Serious incidents: mentioned in the summary, and acted on by a task.
  const summaryTokens = what(tokenize(text));
  const taskTokens = tasks.map((t) => what(tokenize(t.description)));
  incidents.forEach((inc, i) => {
    if (!SERIOUS.has(inc.severity)) return;
    const incTokens = what(tokenize(`${inc.title} ${inc.description || ''}`));
    const label = inc.title;
    if (!sharedTokens(incTokens, summaryTokens).length) {
      flags.push(flag('summary_omits_incident', 'medium', `The ${inc.severity} incident "${label}" is not mentioned in the summary.`, { field: 'summary', ref: { kind: 'incident', index: i } }));
    }
    if (!taskTokens.some((tt) => sharedTokens(incTokens, tt).length)) {
      flags.push(flag('incident_no_action', 'high', `The ${inc.severity} incident "${label}" has no task that follows it up.`, { field: 'tasks', ref: { kind: 'incident', index: i } }));
    }
  });
  if (serious.some((i) => i.severity === 'critical') && !tasks.some((t) => t.priority === 'high' && t.status !== 'resolved')) {
    flags.push(flag('critical_without_high_task', 'medium', 'A critical incident is recorded but no open task is marked high priority.', { field: 'tasks' }));
  }

  // Tasks
  tasks.forEach((t, i) => {
    if (tokenize(t.description).length < QUALITY.minTaskTokens) {
      flags.push(flag('task_vague', 'low', `Task ${i + 1} is vague ("${String(t.description).slice(0, 40)}"). Say what, where and by whom.`, { field: 'tasks', ref: { kind: 'task', index: i } }));
    }
  });
  const reported = new Set();
  for (let i = 0; i < tasks.length; i += 1) {
    for (let j = i + 1; j < tasks.length; j += 1) {
      if (!reported.has(j) && jaccard(taskTokens[i], taskTokens[j]) >= QUALITY.duplicateSimilarity) {
        reported.add(j);
        flags.push(flag('duplicate_task', 'low', `Tasks ${i + 1} and ${j + 1} say almost the same thing.`, { field: 'tasks', ref: { kind: 'task', index: j } }));
      }
    }
  }
  staleTasks.filter((t) => t.carry_depth >= QUALITY.staleCarryDepth).forEach((t) => {
    flags.push(flag('stale_carry', 'medium', `"${String(t.description).slice(0, 50)}" has been carried over ${t.carry_depth} shifts in a row. Resolve it, escalate it, or say why it is waiting.`, { field: 'tasks' }));
  });

  const counts = { high: 0, medium: 0, low: 0 };
  flags.forEach((f) => { counts[f.level] += 1; });
  return { flags, counts, ready: counts.high === 0 };
}

module.exports = { checkHandover, jaccard, FILLER };

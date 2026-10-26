// End-of-shift digest for supervisors. Built from a template, not a language
// model: counts and the items that need a decision, in plain sentences.
//
//   buildDigest(data) -> { title, headline, lines: [...], text }
// data: { department_name, shift_type, shift_end, counts: {submitted, acknowledged, unacknowledged, closed, escalated, no_handover},
//         incidents: {critical, high, medium, low}, open_high_tasks, stale_tasks,
//         attention: [{ record_id, score, level, reasons: [{text}] }], recurring: [{label, occurrences}] }
const NAIROBI = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function buildDigest(d) {
  const c = d.counts || {};
  const inc = d.incidents || {};
  const lines = [];
  if (c.no_handover) lines.push('No handover was submitted for this shift.');
  else lines.push(`${plural(c.submitted || 0, 'handover')} submitted: ${c.acknowledged || 0} acknowledged, ${c.unacknowledged || 0} waiting for acknowledgement, ${c.closed || 0} closed.`);
  if (c.escalated) lines.push(`${plural(c.escalated, 'record')} escalated and not yet resolved.`);
  const serious = (inc.critical || 0) + (inc.high || 0);
  lines.push(serious
    ? `${plural(inc.critical || 0, 'critical incident')} and ${plural(inc.high || 0, 'high-severity incident')} reported.`
    : 'No critical or high-severity incidents reported.');
  if (d.open_high_tasks) lines.push(`${plural(d.open_high_tasks, 'open high-priority task')} to follow up.`);
  if (d.stale_tasks) lines.push(`${plural(d.stale_tasks, 'task')} carried over three or more shifts.`);
  (d.attention || []).slice(0, 3).forEach((a) => {
    lines.push(`Needs attention (${a.level}, score ${a.score}): ${(a.reasons || []).slice(0, 2).map((r) => r.text).join('; ')}.`);
  });
  (d.recurring || []).slice(0, 2).forEach((r) => {
    lines.push(`Recurring: "${String(r.label).slice(0, 80)}" in ${r.occurrences} handovers.`);
  });
  const when = d.shift_end ? NAIROBI.format(new Date(d.shift_end)) : '';
  const title = `${d.department_name}: ${d.shift_type} shift digest${when ? ` (ended ${when} EAT)` : ''}`;
  const headline = c.no_handover
    ? `${d.department_name}: no handover for the ${d.shift_type} shift.`
    : `${d.department_name} ${d.shift_type} shift: ${plural(c.submitted || 0, 'handover')}, ${c.unacknowledged || 0} unacknowledged, ${plural(serious, 'serious incident')}.`;
  return {
    title, headline: cap(headline), lines, text: [title, ...lines].join('\n'),
  };
}

module.exports = { buildDigest };

// Attention ranking for supervisors. A transparent additive score (0 to 100)
// with the reasons listed, so a supervisor can see why a handover is near the
// top and disagree. The weights are constants below, not learned.
//
//   scoreRecord(facts) -> { score, level, reasons: [{ code, points, text }] }
//
// facts: { status, hours_since_submit, incidents: [{severity}], open_tasks: [{priority, carry_depth}],
//          quality_counts: {high, medium, low} }
const { RANKING, QUALITY } = require('./constants');

const WEIGHTS = {
  incident: { critical: 30, high: 18, medium: 6, low: 0 }, incidentCap: 45,
  unackPerHour: 5, unackCap: 25,
  queried: 10,
  escalated: 20,
  highTask: 5, highTaskCap: 15,
  staleTask: 8, staleTaskCap: 16,
  quality: { high: 6, medium: 3, low: 0 }, qualityCap: 12,
};

function scoreRecord(f) {
  const reasons = [];
  const add = (code, points, text) => { if (points > 0) reasons.push({ code, points: Math.round(points), text }); };

  const incPoints = (f.incidents || []).reduce((s, i) => s + (WEIGHTS.incident[i.severity] || 0), 0);
  const nSerious = (f.incidents || []).filter((i) => i.severity === 'critical' || i.severity === 'high').length;
  add('incidents', Math.min(incPoints, WEIGHTS.incidentCap), `${nSerious} high or critical incident${nSerious === 1 ? '' : 's'} on this record`);

  if (f.status === 'submitted' || f.status === 'queried') {
    const h = Math.max(0, f.hours_since_submit || 0);
    add('unacknowledged', Math.min(h * WEIGHTS.unackPerHour, WEIGHTS.unackCap), `not acknowledged ${h < 1 ? 'yet' : `after ${Math.floor(h)} h`}`);
  }
  if (f.status === 'queried') add('queried', WEIGHTS.queried, 'the incoming user has raised a query');
  if (f.status === 'escalated') add('escalated', WEIGHTS.escalated, 'escalated by a supervisor and not yet resolved');

  const highOpen = (f.open_tasks || []).filter((t) => t.priority === 'high').length;
  add('high_tasks', Math.min(highOpen * WEIGHTS.highTask, WEIGHTS.highTaskCap), `${highOpen} open high-priority task${highOpen === 1 ? '' : 's'}`);
  const stale = (f.open_tasks || []).filter((t) => (t.carry_depth || 0) >= QUALITY.staleCarryDepth).length;
  add('stale_tasks', Math.min(stale * WEIGHTS.staleTask, WEIGHTS.staleTaskCap), `${stale} task${stale === 1 ? '' : 's'} carried over ${QUALITY.staleCarryDepth} or more shifts`);

  const q = f.quality_counts || {};
  add('quality', Math.min((q.high || 0) * WEIGHTS.quality.high + (q.medium || 0) * WEIGHTS.quality.medium, WEIGHTS.qualityCap), 'the handover has quality warnings');

  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  const level = score >= RANKING.high ? 'high' : score >= RANKING.medium ? 'medium' : 'low';
  return { score, level, reasons: reasons.sort((a, b) => b.points - a.points) };
}

module.exports = { scoreRecord, WEIGHTS };

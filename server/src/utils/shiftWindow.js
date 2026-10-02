// Shifts run 06:00-18:00 (day) and 18:00-06:00 (night) Nairobi time (UTC+3,
// no DST), i.e. 03:00 and 15:00 UTC. Used by the seed and tests to build
// shifts that cover "now".
const HOUR = 60 * 60 * 1000;

function currentShiftWindow(at = new Date()) {
  const dayStartUtc = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 3);
  let start = dayStartUtc;
  while (start > at.getTime()) start -= 12 * HOUR;
  while (start + 12 * HOUR <= at.getTime()) start += 12 * HOUR;
  const type = new Date(start).getUTCHours() === 3 ? 'day' : 'night';
  return { start: new Date(start), end: new Date(start + 12 * HOUR), type };
}

module.exports = { currentShiftWindow };

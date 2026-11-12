// Phase 3: duty derived from the roster (ROSTER_DUTY_ENABLED).
//
// For a shift S in a department:
//   OUTGOING people = the staff assigned to S (shift_assignment);
//   INCOMING people = the staff assigned to the department's NEXT shift
//                     (the first shift starting at or after S ends).
// The same person is therefore incoming for the shift before theirs and
// outgoing for their own, so people rotate without anybody changing roles.
//
// FALLBACK: with the flag off, or for a shift with no roster, every check
// here answers exactly as today's fixed-role rules do, so existing data,
// seeds and tests behave unchanged.
const { rosterDutyEnabled } = require('../../config/flags');

const STAFF_ROLES = ['outgoing_staff', 'incoming_staff'];
const isStaff = (role) => STAFF_ROLES.includes(role);

async function rosterIds(db, shiftId) {
  const { rows } = await db.query(
    `SELECT sa.user_id FROM shift_assignment sa
       JOIN app_user u ON u.user_id = sa.user_id AND u.is_active
      WHERE sa.shift_id = $1`,
    [shiftId],
  );
  return rows.map((r) => r.user_id);
}

// The department's next shift after `shift` ends (or null).
async function nextShift(db, shift) {
  const { rows: [s] } = await db.query(
    `SELECT * FROM shift
      WHERE department_id = $1 AND start_time >= $2
      ORDER BY start_time LIMIT 1`,
    [shift.department_id, shift.end_time],
  );
  return s || null;
}

// The rostered incoming people for the handover of `shift`:
// { shift: nextShift|null, ids: [user_id] } (ids empty = no roster, fall back).
async function incomingRoster(db, shift) {
  const next = await nextShift(db, shift);
  return { shift: next, ids: next ? await rosterIds(db, next.shift_id) : [] };
}

// May `user` author (create/submit) the handover of `shift`?
// Returns { ok, rostered } — rostered is null when the roster played no part.
async function canAuthorShift(db, user, shift) {
  if (!rosterDutyEnabled()) return { ok: user.role === 'outgoing_staff', rostered: null };
  const ids = await rosterIds(db, shift.shift_id);
  if (!ids.length) return { ok: user.role === 'outgoing_staff', rostered: null }; // no roster: today's rule
  return { ok: isStaff(user.role) && ids.includes(user.user_id), rostered: ids.includes(user.user_id) };
}

// May `user` receive (acknowledge/query) `record`? The record's named
// incoming person always may; with the flag on and a rostered next shift,
// any staff member assigned to that next shift may too, and the
// acknowledgement row records who actually did.
// With the flag on, the record's author never may, even when they are also
// rostered on the next shift (a double shift): nobody signs off their own
// handover.
async function canReceiveRecord(db, user, record, shift) {
  if (rosterDutyEnabled() && record.outgoing_user_id === user.user_id) return false;
  if (record.incoming_user_id === user.user_id) return true;
  if (!rosterDutyEnabled() || !isStaff(user.role)) return false;
  const s = shift || (await db.query('SELECT * FROM shift WHERE shift_id = $1', [record.shift_id])).rows[0];
  if (!s) return false;
  const { ids } = await incomingRoster(db, s);
  return ids.includes(user.user_id); // empty roster: today's rule (named person only)
}

// May `user` (a staff role) read `record` beyond today's rules? True when
// they are rostered on the record's shift (outgoing side) or on the
// department's next shift (incoming side), and always for the record's own
// author, whatever their fixed role and even after they have been taken off
// the roster. Flag off: always false.
async function canViewByRoster(db, user, record) {
  if (!rosterDutyEnabled() || !isStaff(user.role)) return false;
  if (user.department_id !== record.department_id) return false;
  if (record.outgoing_user_id === user.user_id) return true;
  const { rows: [onShift] } = await db.query(
    'SELECT 1 FROM shift_assignment WHERE shift_id = $1 AND user_id = $2',
    [record.shift_id, user.user_id],
  );
  if (onShift) return true;
  return canReceiveRecord(db, user, record);
}

module.exports = {
  STAFF_ROLES, isStaff, rosterIds, nextShift, incomingRoster, canAuthorShift, canReceiveRecord, canViewByRoster,
};

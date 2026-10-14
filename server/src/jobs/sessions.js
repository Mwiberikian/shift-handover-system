// Work-session housekeeping, run by the jobs tick every minute (Part M3).
// runSessionCheck(now) takes the clock as a parameter so tests can drive it.
//
//  1. Sessions with no heartbeat for 10 minutes end at their last heartbeat
//     (end_reason 'heartbeat').
//  2. Sessions still open 30 minutes after their shift's end end at that
//     moment (end_reason 'shift_end').
//     If both apply, the earlier time wins.
//  3. Every timer of an ended session stops (at the session's end).
//  4. Every timer on a task whose handover is no longer a draft stops (at the
//     submission time). Submit already does this in its own transaction; this
//     is the safety net.
const pool = require('../config/db');
const { withTransaction } = require('../db/tx');
const sessions = require('../modules/sessions/sessions.service');

async function runSessionCheck(now = new Date(), { db = pool } = {}) {
  const run = async (client) => {
    const ended = await sessions.expireStale(client, now);
    const submittedTimers = await sessions.stopTimersOfSubmittedRecords(client);
    return {
      ended: ended.map((s) => ({ session_id: s.session_id, user_id: s.user_id, end_reason: s.end_reason, ended_at: s.ended_at })),
      timers_stopped_on_submit: submittedTimers,
    };
  };
  return db === pool ? withTransaction(run) : run(db);
}

module.exports = { runSessionCheck };

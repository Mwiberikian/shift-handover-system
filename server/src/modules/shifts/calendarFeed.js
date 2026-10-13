// Calendar subscription feed (Part K).
//
// A user creates a private feed URL from their menu and pastes it into a
// calendar app, which then fetches GET /api/shifts/calendar/<token>.ics on
// its own schedule. Calendar apps cannot send a bearer token, so the URL
// itself is the credential: 32 random bytes, shown once, stored only as a
// SHA-256 hash, revocable and regenerable. The feed holds the user's own
// rostered shifts (name, times, department, a 30-minute alarm) and nothing
// else.
const crypto = require('crypto');
const pool = require('../../config/db');
const { withTransaction } = require('../../db/tx');
const { writeAudit } = require('../../utils/audit');
const ics = require('../../utils/ics');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/; // 32 bytes, base64url, no padding

// Shifts in the feed: 30 days back to 90 days ahead.
const PAST_DAYS = 30;
const FUTURE_DAYS = 90;

async function status(userId) {
  const { rows: [u] } = await pool.query(
    'SELECT calendar_feed_hash IS NOT NULL AS active, calendar_feed_created_at AS created_at FROM app_user WHERE user_id = $1',
    [userId],
  );
  return { active: u.active, created_at: u.active ? u.created_at : null };
}

// Creates a feed token, replacing any earlier one. Returns the token once.
async function create(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  return withTransaction(async (client) => {
    const { rows: [before] } = await client.query(
      'SELECT calendar_feed_hash IS NOT NULL AS active FROM app_user WHERE user_id = $1 FOR UPDATE', [userId],
    );
    const { rows: [after] } = await client.query(
      'UPDATE app_user SET calendar_feed_hash = $2, calendar_feed_created_at = now() WHERE user_id = $1 RETURNING calendar_feed_created_at',
      [userId, hashToken(token)],
    );
    await writeAudit(client, {
      userId, entityType: 'app_user', entityId: userId, action: before.active ? 'calendar_feed_regenerate' : 'calendar_feed_create',
      previousValue: { active: before.active }, newValue: { active: true },
    });
    return { token, created_at: after.calendar_feed_created_at };
  });
}

async function revoke(userId) {
  return withTransaction(async (client) => {
    const { rows: [before] } = await client.query(
      'SELECT calendar_feed_hash IS NOT NULL AS active FROM app_user WHERE user_id = $1 FOR UPDATE', [userId],
    );
    if (before.active) {
      await client.query('UPDATE app_user SET calendar_feed_hash = NULL, calendar_feed_created_at = NULL WHERE user_id = $1', [userId]);
      await writeAudit(client, {
        userId, entityType: 'app_user', entityId: userId, action: 'calendar_feed_revoke',
        previousValue: { active: true }, newValue: { active: false },
      });
    }
    return { active: false, created_at: null };
  });
}

// The .ics text for a token, or null (unknown, revoked, malformed, or the
// account is inactive). Callers answer null with a plain 404.
async function feedFor(token) {
  if (!TOKEN_SHAPE.test(token || '')) return null;
  const { rows: [user] } = await pool.query(
    'SELECT user_id FROM app_user WHERE calendar_feed_hash = $1 AND is_active',
    [hashToken(token)],
  );
  if (!user) return null;
  const { rows: shifts } = await pool.query(
    `SELECT s.shift_id, s.shift_type, s.start_time, s.end_time, d.name AS department_name
       FROM shift_assignment sa
       JOIN shift s ON s.shift_id = sa.shift_id
       JOIN department d ON d.department_id = s.department_id
      WHERE sa.user_id = $1
        AND s.end_time > now() - make_interval(days => $2)
        AND s.start_time < now() + make_interval(days => $3)
      ORDER BY s.start_time`,
    [user.user_id, PAST_DAYS, FUTURE_DAYS],
  );
  return ics.calendar(shifts, { name: 'My shifts (Shift Handover)', alarmMinutes: 30 });
}

module.exports = {
  status, create, revoke, feedFor, hashToken,
};

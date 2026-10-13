// Sends queued emails (IR-05, IR-06). Called from the jobs tick, never inside
// a notification's transaction.
//
// Each row gets one first attempt and up to MAX_RETRIES retries, with
// exponential backoff: base, 2 x base, 4 x base (base = EMAIL_RETRY_BASE_MINUTES,
// default 1 minute, so 1, 2 and 4 minutes). After the last failed attempt the
// row is 'failed'. The outcome (sent or failed) is written to the notification
// too. A refusal (email switched off, or the recipient's domain no longer
// allowed) is final at once: retrying cannot change it.
//
// Rows are claimed with FOR UPDATE SKIP LOCKED and a short lease on
// next_attempt_at, so overlapping ticks or a second process never send the
// same row twice at the same time.
const pool = require('../../../config/db');
const logger = require('../../../utils/logger');
const { emailConfig, sendEmail, EmailRefused } = require('./mailer');
const { buildEmail } = require('./content');

const MAX_RETRIES = 3;
const LEASE_MS = 5 * 60 * 1000;

function retryBaseMs(env = process.env) {
  const v = Number(env.EMAIL_RETRY_BASE_MINUTES);
  return (Number.isFinite(v) && v > 0 ? v : 1) * 60 * 1000;
}

// Delay before retry n (n = 1, 2, 3) = base * 2^(n - 1).
const backoffMs = (retry, base = retryBaseMs()) => base * 2 ** (retry - 1);

async function claim(now, limit) {
  const { rows } = await pool.query(
    `UPDATE email_outbox o SET next_attempt_at = $1::timestamptz + make_interval(secs => $3)
      WHERE o.id IN (
        SELECT id FROM email_outbox
         WHERE status = 'pending' AND next_attempt_at <= $1
         ORDER BY next_attempt_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
     RETURNING o.*`,
    [now, limit, LEASE_MS / 1000],
  );
  return rows;
}

async function settle(row, now, outcome) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (outcome.sent) {
      await client.query(
        "UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, sent_at = $2, last_error = NULL WHERE id = $1",
        [row.id, now],
      );
    } else {
      await client.query(
        `UPDATE email_outbox SET status = $2, attempts = attempts + 1, last_error = $3, next_attempt_at = $4 WHERE id = $1`,
        [row.id, outcome.final ? 'failed' : 'pending', outcome.error.slice(0, 500), outcome.final ? now : outcome.retryAt],
      );
    }
    if (outcome.sent || outcome.final) {
      await client.query(
        'UPDATE notification SET email_status = $2, email_status_at = $3 WHERE notification_id = $1',
        [row.notification_id, outcome.sent ? 'sent' : 'failed', now],
      );
      if (outcome.final && outcome.onFinalFailure) await outcome.onFinalFailure(client, row);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Hooks run in the same transaction when a row finally fails, e.g. to make
// sure the recipient still gets the alert in-app (registered by messages).
const finalFailureHooks = [];
const onFinalFailure = (fn) => finalFailureHooks.push(fn);

// Sends what is due at `now`. Returns [{ id, status, attempts, error }].
async function processOutbox({ now = new Date(), limit = 20 } = {}) {
  const cfg = emailConfig();
  const base = retryBaseMs();
  const results = [];
  for (const row of await claim(now, limit)) {
    const attempt = row.attempts + 1;
    const { rows: [n] } = await pool.query('SELECT type, title FROM notification WHERE notification_id = $1', [row.notification_id]);
    try {
      await sendEmail({ to: row.to_address, ...buildEmail(n, cfg) }, cfg);
      await settle(row, now, { sent: true });
      results.push({ id: row.id, status: 'sent', attempts: attempt });
    } catch (err) {
      const refused = err instanceof EmailRefused;
      const final = refused || attempt > MAX_RETRIES;
      const retryAt = new Date(now.getTime() + backoffMs(attempt, base));
      const error = err.message || String(err);
      await settle(row, now, {
        sent: false, final, retryAt, error,
        onFinalFailure: async (client, r) => { for (const hook of finalFailureHooks) await hook(client, r); },
      });
      logger.warn(`[email] ${final ? 'FAILED' : 'retry'} outbox=${row.id} notification=${row.notification_id} attempt=${attempt}`
        + `${final ? '' : ` next=${retryAt.toISOString()}`}: ${error}`);
      results.push({ id: row.id, status: final ? 'failed' : 'pending', attempts: attempt, error });
    }
  }
  return results;
}

module.exports = {
  processOutbox, backoffMs, retryBaseMs, onFinalFailure, MAX_RETRIES,
};

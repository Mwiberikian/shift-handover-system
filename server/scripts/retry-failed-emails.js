// Puts every 'failed' email_outbox row back in the queue, for an admin to run
// by hand once the cause is fixed. The next jobs tick (EMAIL_ENABLED=true) sends
// them, with a fresh set of attempts.
//
//   cd server && node scripts/retry-failed-emails.js
//
// The notification's email_status goes back to 'pending' with its row, so the
// supervisor dashboard stops listing the email as failed while it is queued.
// last_error is kept until the next attempt replaces or clears it.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const pool = require('../src/config/db');

async function retryFailedEmails(db = pool) {
  const { rowCount } = await db.query(
    `WITH reset AS (
       UPDATE email_outbox
          SET status = 'pending', attempts = 0, next_attempt_at = now()
        WHERE status = 'failed'
       RETURNING notification_id
     )
     UPDATE notification n
        SET email_status = 'pending', email_status_at = now()
       FROM reset
      WHERE n.notification_id = reset.notification_id`,
  );
  return rowCount;
}

if (require.main === module) {
  retryFailedEmails()
    .then((count) => console.log(`Reset ${count} failed email(s) to pending.`))
    .catch((err) => {
      console.error('Retry failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = { retryFailedEmails };

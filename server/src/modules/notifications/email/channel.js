// The 'email' notification channel. Runs inside the notification's
// transaction and only queues: one email_outbox row per in-app notification
// whose recipient can be emailed. Sending happens later (outbox.js).
const logger = require('../../../utils/logger');
const { emailConfig, refusalReason } = require('./mailer');
const { buildEmail } = require('./content');

// Notification types that may be emailed (see also eligibleTypes()).
const DEFAULT_TYPES = [
  'handover_submitted', 'handover_queried', 'handover_clarified', 'handover_escalated', 'handover_resolved',
  'reminder', 'message',
];

function eligibleTypes(env = process.env) {
  const list = (env.EMAIL_NOTIFICATION_TYPES || '').split(',').map((t) => t.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_TYPES;
}

async function enqueueEmails(db, rows, notification) {
  const cfg = emailConfig();
  if (!cfg.enabled || !eligibleTypes().includes(notification.type)) return [];

  const queued = [];
  for (const { notification_id: id, recipient_id: userId } of rows) {
    const { rows: [user] } = await db.query(
      'SELECT email, is_active FROM app_user WHERE user_id = $1',
      [userId],
    );
    if (!user || !user.is_active) continue;
    const reason = refusalReason(user.email, cfg);
    if (reason) {
      logger.warn(`[email] not queued for user=${userId} notification=${id}: ${reason}`);
      continue;
    }
    const { subject } = buildEmail(notification, cfg);
    await db.query(
      'INSERT INTO email_outbox (notification_id, to_address, subject, next_attempt_at) VALUES ($1, $2, $3, COALESCE($4, now()))',
      [id, user.email, subject, notification.at],
    );
    await db.query(
      "UPDATE notification SET email_status = 'pending', email_status_at = COALESCE($2, now()) WHERE notification_id = $1",
      [id, notification.at],
    );
    queued.push(id);
  }
  return queued;
}

module.exports = { enqueueEmails, eligibleTypes, DEFAULT_TYPES };

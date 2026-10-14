// The 'push' notification channel (Part R3): Web Push to the devices a user
// turned on with "Push notifications on this device".
//
// - Off unless PUSH_ENABLED=true with VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
//   VAPID_SUBJECT set (npm run vapid makes a key pair).
// - The same notification types as email (EMAIL_NOTIFICATION_TYPES), and the
//   same callers request it.
// - The payload is a title and a link inside the app, never handover, report
//   or message content: push services and lock screens are outside our
//   control. Reminder titles are fixed phrases; their bodies are not sent.
// - Sending happens after the notification's transaction commits, so a
//   rolled-back change never buzzes a phone, and a slow push service never
//   holds up a handover.
// - A subscription the push service reports gone (404 or 410) is deleted;
//   other failures count up in failed_count.
const webpush = require('web-push');
const pool = require('../../../config/db');
const logger = require('../../../utils/logger');
const { afterCommit } = require('../../../db/tx');
const { eligibleTypes } = require('../email/channel');
const { titleFor } = require('../email/content');

function pushConfig(env = process.env) {
  const publicKey = (env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (env.VAPID_SUBJECT || '').trim();
  const wanted = env.PUSH_ENABLED === 'true';
  return {
    enabled: wanted && Boolean(publicKey && privateKey && subject),
    wanted,
    publicKey,
    privateKey,
    subject,
  };
}

// Where a tap on the notification opens: the recipient's own screen for it.
const ROLE_HOME = {
  outgoing_staff: '/outgoing', incoming_staff: '/incoming', supervisor: '/supervisor/queue', admin: '/admin/users',
};

function linkFor(notification, role) {
  if (notification.type === 'message') return '/messages';
  if (notification.type === 'reminder' && role === 'supervisor') return '/supervisor';
  return ROLE_HOME[role] || '/';
}

// Exactly what is sent. Nothing else from the notification goes in.
function buildPayload(notification, role) {
  return { title: titleFor(notification), link: linkFor(notification, role) };
}

// Sends one payload to every subscription of each recipient. Returns
// { sent, pruned, failed } for logging and tests.
async function sendToUsers(recipients, notification, { db = pool, cfg = pushConfig() } = {}) {
  const result = { sent: 0, pruned: 0, failed: 0 };
  if (!recipients.length) return result;
  const { rows: subs } = await db.query(
    `SELECT s.id, s.endpoint, s.p256dh, s.auth, u.role
       FROM push_subscription s JOIN app_user u ON u.user_id = s.user_id
      WHERE s.user_id = ANY($1::uuid[]) AND u.is_active`,
    [recipients],
  );
  const options = {
    TTL: 60 * 60, // an hour: older alerts are not worth delivering
    urgency: 'high',
    vapidDetails: { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey },
  };
  for (const s of subs) {
    const payload = JSON.stringify(buildPayload(notification, s.role));
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, options);
      await db.query('UPDATE push_subscription SET last_success_at = now(), failed_count = 0 WHERE id = $1', [s.id]);
      result.sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query('DELETE FROM push_subscription WHERE id = $1', [s.id]);
        result.pruned += 1;
      } else {
        await db.query('UPDATE push_subscription SET failed_count = failed_count + 1 WHERE id = $1', [s.id]);
        result.failed += 1;
        logger.warn(`[push] send failed for subscription ${s.id}: ${err.statusCode ?? ''} ${err.message}`);
      }
    }
  }
  return result;
}

// The notify() channel. Inside the transaction it only decides; the send is
// queued for after COMMIT.
async function enqueuePush(db, rows, notification) {
  const cfg = pushConfig();
  if (!cfg.enabled || !eligibleTypes().includes(notification.type)) return;
  const recipients = [...new Set(rows.map((r) => r.recipient_id))];
  afterCommit(db, () => sendToUsers(recipients, notification, { cfg }));
}

module.exports = {
  pushConfig, buildPayload, linkFor, sendToUsers, enqueuePush,
};

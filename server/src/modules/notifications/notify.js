// The notification service (IR-05). This is the only code that inserts
// notification rows; handovers, messages and the reminders job all call it.
//
//   notify({ userIds, type, title, body, ref, at }, { channels, db })
//
// - userIds: recipients; duplicates and empty values are dropped.
// - type: 'handover_submitted', 'message', 'reminder', ...
// - title, body: optional display text (reminders set them; handover
//   notifications are rendered from type and record by the client).
// - ref: links to what the notification is about:
//   { record_id, message_id, shift_id, reminder_type }.
// - at: sent_at (defaults to now(); the reminders job passes its clock).
// - channels: 'in_app' is always delivered; other channels (e.g. 'email')
//   are optional and registered with registerChannel(): 'email' (queued in
//   the outbox) and 'push' (Web Push, sent after the transaction commits).
// - db: the caller's transaction client, so the notification commits or rolls
//   back with the change it reports. Defaults to the pool.
//
// Returns the in-app rows: [{ notification_id, recipient_id }].
const pool = require('../../config/db');

const channels = new Map();

// A channel gets (db, rows, notification) inside the same transaction, after
// the in-app rows exist. It must not do slow I/O there; the email channel only
// queues outbox rows.
function registerChannel(name, handler) {
  channels.set(name, handler);
}

async function insertInApp(db, recipients, { type, title, body, ref, at }) {
  const rows = [];
  for (const recipientId of recipients) {
    const { rows: [row] } = await db.query(
      `INSERT INTO notification (recipient_id, type, title, body, record_id, message_id, shift_id, reminder_type, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now()))
       RETURNING notification_id, recipient_id`,
      [recipientId, type, title, body, ref.record_id ?? null, ref.message_id ?? null, ref.shift_id ?? null,
        ref.reminder_type ?? null, at],
    );
    rows.push(row);
  }
  return rows;
}

async function notify({
  userIds, type, title = null, body = null, ref = {}, at = null,
}, { channels: wanted = [], db = pool } = {}) {
  if (!type) throw new Error('notify: type is required');
  const recipients = [...new Set((userIds || []).filter(Boolean))];
  if (!recipients.length) return [];

  const extra = [...new Set(wanted)].filter((c) => c !== 'in_app');
  for (const name of extra) {
    if (!channels.has(name)) throw new Error(`notify: unknown channel '${name}'`);
  }

  const notification = {
    type, title, body, ref, at,
  };
  const rows = await insertInApp(db, recipients, notification);
  for (const name of extra) {
    await channels.get(name)(db, rows, notification);
  }
  return rows;
}

// Built-in channels.
registerChannel('email', require('./email/channel').enqueueEmails);
registerChannel('push', require('./push/push').enqueuePush);

module.exports = { notify, registerChannel };

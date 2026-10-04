// Shift reminders. A node-cron job ticks every minute (started from server.js,
// never under NODE_ENV=test); all logic is in runReminderCheck(now), which
// takes the clock as a parameter so tests can drive it.
//
// Each reminder is due at a fixed moment relative to a shift. A tick sends
// every reminder whose due moment is in (now - lookback, now], so a short
// outage or a slow tick catches up, but an old backlog is not replayed.
// Delivery inserts into reminder_log first (unique per type/ref/user) and
// only creates the notification if that insert happened, so a reminder can
// never be sent twice.
const cron = require('node-cron');
const pool = require('../config/db');
const { UNACK_ALERT_HOURS } = require('../config/constants');

const minutes = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

function reminderConfig() {
  return {
    shiftStart: minutes('REMINDER_SHIFT_START_MINUTES', 30), // before shift start
    handoverDueFirst: minutes('REMINDER_HANDOVER_DUE_FIRST_MINUTES', 30), // before shift end
    handoverDueFinal: minutes('REMINDER_HANDOVER_DUE_FINAL_MINUTES', 10), // before shift end
    ackPending: minutes('REMINDER_ACK_PENDING_MINUTES', 15), // after incoming shift start
    unackAlert: minutes('REMINDER_UNACK_ALERT_MINUTES', UNACK_ALERT_HOURS * 60), // after incoming shift start
    lookback: minutes('REMINDER_LOOKBACK_MINUTES', 60),
  };
}

// Times are shown in Nairobi time (DR-02) whatever the server's timezone.
const NAIROBI_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const hhmm = (d) => `${NAIROBI_TIME.format(new Date(d))} EAT`;
const shiftName = (s) => `${s.shift_type.charAt(0).toUpperCase()}${s.shift_type.slice(1)} shift`;

// due = anchor + offset; due must fall in (now - lookback, now].
const DUE_WINDOW = (anchor, sign) => `
      ${anchor} ${sign} make_interval(mins => $2) <= $1
  AND ${anchor} ${sign} make_interval(mins => $2) > $1 - make_interval(mins => $3)`;

const SHIFT_COLUMNS = 's.shift_id, s.shift_type, s.start_time, s.end_time, s.department_id, d.name AS department_name';

async function deliver(db, now, r) {
  const { rows } = await db.query(
    `WITH logged AS (
       INSERT INTO reminder_log (reminder_type, ref_id, user_id, sent_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT ON CONSTRAINT reminder_log_once DO NOTHING
       RETURNING 1)
     INSERT INTO notification (recipient_id, type, reminder_type, title, body, record_id, shift_id, sent_at)
     SELECT $3, 'reminder', $1, $5, $6, $7, $8, $4 FROM logged
     RETURNING notification_id`,
    [r.type, r.refId, r.userId, now, r.title, r.body, r.recordId ?? null, r.shiftId ?? null],
  );
  return rows.length > 0;
}

// Each rule returns reminder candidates for this tick.
const RULES = [
  // 1. Assigned staff: shift starting soon.
  async (db, now, c) => {
    const { rows } = await db.query(
      `SELECT sa.user_id, ${SHIFT_COLUMNS}
         FROM shift_assignment sa
         JOIN shift s USING (shift_id)
         JOIN department d ON d.department_id = s.department_id
         JOIN app_user u ON u.user_id = sa.user_id AND u.is_active
        WHERE ${DUE_WINDOW('s.start_time', '-')} AND s.start_time > $1`,
      [now, c.shiftStart, c.lookback],
    );
    return rows.map((s) => ({
      type: 'shift_start', refId: s.shift_id, userId: s.user_id, shiftId: s.shift_id,
      title: 'Shift starting soon',
      body: `Your ${shiftName(s).toLowerCase()} in ${s.department_name} starts at ${hhmm(s.start_time)}.`,
    }));
  },

  // 2. Assigned outgoing staff: handover due (two lead times) while nothing
  //    has been submitted for the shift.
  ...[['handover_due_first', 'handoverDueFirst'], ['handover_due_final', 'handoverDueFinal']].map(([type, key]) => async (db, now, c) => {
    const { rows } = await db.query(
      `SELECT sa.user_id, ${SHIFT_COLUMNS}
         FROM shift_assignment sa
         JOIN shift s USING (shift_id)
         JOIN department d ON d.department_id = s.department_id
         JOIN app_user u ON u.user_id = sa.user_id AND u.is_active AND u.role = 'outgoing_staff'
        WHERE ${DUE_WINDOW('s.end_time', '-')} AND s.end_time > $1
          AND NOT EXISTS (SELECT 1 FROM handover_record r WHERE r.shift_id = s.shift_id AND r.status <> 'draft')`,
      [now, c[key], c.lookback],
    );
    return rows.map((s) => ({
      type, refId: s.shift_id, userId: s.user_id, shiftId: s.shift_id,
      title: type === 'handover_due_final' ? 'Handover due now' : 'Handover due soon',
      body: `Your ${shiftName(s).toLowerCase()} ends at ${hhmm(s.end_time)}. The handover has not been submitted yet.`,
    }));
  }),

  // 3. Incoming user: handover still waiting for acknowledgement after the
  //    incoming shift (= the record's shift end) has started.
  async (db, now, c) => {
    const { rows } = await db.query(
      `SELECT r.record_id, r.incoming_user_id AS user_id, o.full_name AS outgoing_name, ${SHIFT_COLUMNS}
         FROM handover_record r
         JOIN shift s ON s.shift_id = r.shift_id
         JOIN department d ON d.department_id = s.department_id
         JOIN app_user i ON i.user_id = r.incoming_user_id AND i.is_active
         LEFT JOIN app_user o ON o.user_id = r.outgoing_user_id
        WHERE r.status = 'submitted' AND ${DUE_WINDOW('s.end_time', '+')}`,
      [now, c.ackPending, c.lookback],
    );
    return rows.map((s) => ({
      type: 'ack_pending', refId: s.record_id, userId: s.user_id, recordId: s.record_id, shiftId: s.shift_id,
      title: 'Handover awaiting your acknowledgement',
      body: `${s.outgoing_name ?? 'The outgoing staff member'}'s ${shiftName(s).toLowerCase()} handover for ${s.department_name} is waiting for you to acknowledge it.`,
    }));
  },

  // 4a. Supervisors: still unacknowledged N minutes after the incoming shift
  //     started (FR-19, matching the dashboard flag).
  async (db, now, c) => {
    const { rows } = await db.query(
      `SELECT r.record_id, sup.user_id, i.full_name AS incoming_name, ${SHIFT_COLUMNS}
         FROM handover_record r
         JOIN shift s ON s.shift_id = r.shift_id
         JOIN department d ON d.department_id = s.department_id
         JOIN app_user sup ON sup.department_id = r.department_id AND sup.role = 'supervisor' AND sup.is_active
         LEFT JOIN app_user i ON i.user_id = r.incoming_user_id
        WHERE r.status IN ('submitted', 'queried') AND ${DUE_WINDOW('s.end_time', '+')}`,
      [now, c.unackAlert, c.lookback],
    );
    const hours = Math.round((c.unackAlert / 60) * 10) / 10;
    return rows.map((s) => ({
      type: 'supervisor_unacknowledged', refId: s.record_id, userId: s.user_id, recordId: s.record_id, shiftId: s.shift_id,
      title: 'Handover not acknowledged',
      body: `${s.department_name}: the ${shiftName(s).toLowerCase()} handover is still unacknowledged ${hours} h after the shift change at ${hhmm(s.end_time)}${s.incoming_name ? ` (assigned to ${s.incoming_name})` : ''}.`,
    }));
  },

  // 4b. Supervisors: a shift ended with no submitted handover.
  async (db, now, c) => {
    const { rows } = await db.query(
      `SELECT sup.user_id, ${SHIFT_COLUMNS}
         FROM shift s
         JOIN department d ON d.department_id = s.department_id
         JOIN app_user sup ON sup.department_id = s.department_id AND sup.role = 'supervisor' AND sup.is_active
        WHERE ${DUE_WINDOW('s.end_time', '+')}
          AND NOT EXISTS (SELECT 1 FROM handover_record r WHERE r.shift_id = s.shift_id AND r.status <> 'draft')`,
      [now, 0, c.lookback],
    );
    return rows.map((s) => ({
      type: 'supervisor_no_handover', refId: s.shift_id, userId: s.user_id, shiftId: s.shift_id,
      title: 'Shift ended without a handover',
      body: `${s.department_name}: the ${shiftName(s).toLowerCase()} ended at ${hhmm(s.end_time)} with no handover submitted.`,
    }));
  },
];

// Sends every reminder due at `now`. Returns what was sent this tick.
async function runReminderCheck(now = new Date(), { db = pool, config = reminderConfig() } = {}) {
  const sent = [];
  for (const rule of RULES) {
    for (const r of await rule(db, now, config)) {
      if (await deliver(db, now, r)) sent.push({ type: r.type, user_id: r.userId, ref_id: r.refId });
    }
  }
  return sent;
}

function startReminderScheduler({ logger = console } = {}) {
  let running = false;
  const task = cron.schedule('* * * * *', async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      const sent = await runReminderCheck(new Date());
      if (sent.length) logger.log(`[reminders] sent ${sent.length}: ${sent.map((s) => s.type).join(', ')}`);
    } catch (err) {
      logger.error('[reminders] check failed:', err.message);
    } finally {
      running = false;
    }
  });
  return task;
}

module.exports = {
  runReminderCheck, startReminderScheduler, reminderConfig, hhmm,
};

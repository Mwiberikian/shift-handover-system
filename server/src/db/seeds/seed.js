/**
 * Development seed for SHMS.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. Names, staff numbers, emails and
 * operational details are invented for the prototype/demo and do not describe
 * real Kenya Airways staff, aircraft or events. Every free-text value the seed
 * writes (record summaries, tasks, incidents, reports, notification titles)
 * starts with "SYNTHETIC".
 *
 * Usage:  npm run seed
 * This wipes every SHMS table (TRUNCATE) and rebuilds the demo data set, so
 * running it again gives the same users, roster and sample data (idempotent).
 * Refuses to run when NODE_ENV=production.
 *
 * People (57): per department 2 supervisors, 6 outgoing and 6 incoming staff,
 * plus one administrator. The original 13 accounts keep their staff numbers,
 * names, emails and password.
 *
 * Time: shifts for every department from 06:00 Nairobi time seven days ago up
 * to the next shift, with 3 outgoing and 3 incoming staff rostered on each.
 * Every past shift has a handover record, work sessions, task timers and a
 * submitted shift report shared with the department's first supervisor.
 *
 * Department codes are limited to varchar(10) by the schema, so Maintenance and
 * Customer Service use the short codes 'maint' and 'cust_svc'.
 *
 * Every seeded account uses the password in DEMO_PASSWORD below.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env'), quiet: true });

const bcrypt = require('bcrypt');
const pool = require('../../config/db');
const { BCRYPT_ROUNDS } = require('../../config/constants');
const { currentShiftWindow } = require('../../utils/shiftWindow');
const { formatEAT } = require('../../utils/eat');
const { notify } = require('../../modules/notifications/notify');

const DEMO_PASSWORD = 'Password123!';

const DEPARTMENTS = [
  { code: 'ground_ops', name: 'Ground Operations', prefix: 1 },
  { code: 'maint', name: 'Aircraft Maintenance', prefix: 2 },
  { code: 'cust_svc', name: 'Customer Service', prefix: 3 },
  { code: 'flight_ops', name: 'Flight Operations', prefix: 4 },
];

// field_definition format (see modules/handovers/template.validation.js):
//   fields[].key is one of 'summary_notes' | 'tasks' | 'incidents'
//   required + minLength (text) / minItems (list) are enforced on submit.
const TEMPLATES = {
  ground_ops: {
    fields: [
      { key: 'summary_notes', label: 'Apron & turnaround summary', type: 'text', required: true, minLength: 20 },
      { key: 'tasks', label: 'Outstanding ground tasks', type: 'list', required: true, minItems: 1 },
      { key: 'incidents', label: 'Ramp incidents', type: 'list', required: false },
    ],
  },
  maint: {
    fields: [
      { key: 'summary_notes', label: 'Aircraft status & deferred defects', type: 'text', required: true, minLength: 30 },
      { key: 'tasks', label: 'Open work orders', type: 'list', required: true, minItems: 1 },
      { key: 'incidents', label: 'Technical occurrences', type: 'list', required: false },
    ],
  },
  cust_svc: {
    fields: [
      { key: 'summary_notes', label: 'Passenger service summary', type: 'text', required: true, minLength: 10 },
      { key: 'tasks', label: 'Pending passenger cases', type: 'list', required: false },
      { key: 'incidents', label: 'Service incidents', type: 'list', required: false },
    ],
  },
  flight_ops: {
    fields: [
      { key: 'summary_notes', label: 'Operations control summary', type: 'text', required: true, minLength: 20 },
      { key: 'tasks', label: 'Open operational actions', type: 'list', required: true, minItems: 1 },
      { key: 'incidents', label: 'Operational disruptions', type: 'list', required: false },
    ],
  },
};

// The original synthetic staff: one outgoing, one incoming and one supervisor
// per department, and the administrator. Unchanged since the first seed.
const ORIGINAL_USERS = [
  ['KQ1001', 'Achieng Otieno', 'ground_ops', 'outgoing_staff'],
  ['KQ1002', 'Brian Kamau', 'ground_ops', 'incoming_staff'],
  ['KQ1003', 'Wanjiru Mwangi', 'ground_ops', 'supervisor'],
  ['KQ2001', 'Daniel Kiprop', 'maint', 'outgoing_staff'],
  ['KQ2002', 'Faith Njeri', 'maint', 'incoming_staff'],
  ['KQ2003', 'Joseph Mutua', 'maint', 'supervisor'],
  ['KQ3001', 'Grace Akinyi', 'cust_svc', 'outgoing_staff'],
  ['KQ3002', 'Kevin Omondi', 'cust_svc', 'incoming_staff'],
  ['KQ3003', 'Mercy Wambui', 'cust_svc', 'supervisor'],
  ['KQ4001', 'Samuel Cheruiyot', 'flight_ops', 'outgoing_staff'],
  ['KQ4002', 'Lucy Chebet', 'flight_ops', 'incoming_staff'],
  ['KQ4003', 'Peter Ndungu', 'flight_ops', 'supervisor'],
  ['KQ9001', 'System Administrator', null, 'admin'],
];

// Invented names for the added staff (Part M1), 11 per department.
const ADDED_NAMES = {
  ground_ops: ['Esther Wairimu', 'Collins Ouma', 'Nancy Moraa', 'Dennis Kiplagat', 'Ruth Nyambura', 'Victor Mutiso',
    'Janet Adhiambo', 'George Kibet', 'Irene Wangui', 'Patrick Odhiambo', 'Sharon Jeptoo'],
  maint: ['Martin Kariuki', 'Purity Chepkoech', 'Stephen Onyango', 'Agnes Mumbua', 'Erick Rotich', 'Caroline Nduta',
    'Felix Wekesa', 'Diana Kemunto', 'Moses Langat', 'Lydia Wanjiku', 'Hassan Abdi'],
  cust_svc: ['Beatrice Atieno', 'Alex Muriuki', 'Winnie Chelangat', 'Isaac Barasa', 'Christine Kerubo', 'Paul Macharia',
    'Rose Nafula', 'Kennedy Ochieng', 'Joy Wambua', 'Simon Lagat', 'Mary Auma'],
  flight_ops: ['Ibrahim Hussein', 'Catherine Muthoni', 'Allan Kimani', 'Eunice Jelagat', 'Brian Owino', 'Doris Kanini',
    'Anthony Waweru', 'Sarah Achieng', 'Daniel Njoroge', 'Teresa Mwende', 'Kelvin Korir'],
};

// Staff numbers per department d (1-4): KQd001 outgoing, KQd002 incoming and
// KQd003 supervisor (original); KQd004 second supervisor; KQd011-KQd015 more
// outgoing staff; KQd021-KQd025 more incoming staff.
function addedUsers() {
  const users = [];
  for (const { code, prefix } of DEPARTMENTS) {
    const names = [...ADDED_NAMES[code]];
    users.push([`KQ${prefix}004`, names.shift(), code, 'supervisor']);
    for (let i = 1; i <= 5; i += 1) users.push([`KQ${prefix}01${i}`, names.shift(), code, 'outgoing_staff']);
    for (let i = 1; i <= 5; i += 1) users.push([`KQ${prefix}02${i}`, names.shift(), code, 'incoming_staff']);
  }
  return users;
}

const USERS = [...ORIGINAL_USERS, ...addedUsers()];

const emailFor = (fullName) => `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@shms.example`;

// The six outgoing and six incoming staff of a department, originals first.
const staffOf = (prefix, role) => USERS
  .filter(([s, , , r]) => r === role && s.startsWith(`KQ${prefix}`))
  .map(([s]) => s);

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const DAYS_BACK = 7;

// Synthetic work items, picked by shift so the history is varied.
const TASKS = {
  ground_ops: ['Check GPU on stand 3', 'Reconcile baggage count for the late inbound', 'Inspect tug 12 tyres', 'Restock chocks at stand 7'],
  maint: ['Close work order for the cabin light defect', 'Borescope inspection on engine 2', 'Replace the brake wear pin', 'Update the deferred defect log'],
  cust_svc: ['Follow up the delayed bag claim', 'Rebook transfer passengers', 'Reply to the wheelchair request', 'File the lounge complaint'],
  flight_ops: ['Confirm the crew rest calculation', 'Update the NOTAM briefing pack', 'Recheck the fuel plan for the night departure', 'File the slot change'],
};

// Shifts from 06:00 Nairobi time DAYS_BACK days ago to the next shift.
function shiftStarts(now) {
  const { start: current, type } = currentShiftWindow(now);
  const todayDay = type === 'day' ? current : new Date(current.getTime() - 12 * HOUR);
  const first = new Date(todayDay.getTime() - DAYS_BACK * 24 * HOUR);
  const starts = [];
  for (let t = first.getTime(); t <= current.getTime() + 12 * HOUR; t += 12 * HOUR) starts.push(new Date(t));
  // offset: 0 for the current shift, negative before it, 1 for the next.
  return starts.map((start) => ({
    start,
    end: new Date(start.getTime() + 12 * HOUR),
    type: start.getUTCHours() === 3 ? 'day' : 'night',
    offset: Math.round((start - current) / (12 * HOUR)),
  }));
}

// Who is rostered on a shift. Shifts alternate between two teams so that the
// original outgoing user (KQd001) works the current shift and the original
// incoming user (KQd002) the next one, as in the first seed.
function rosterFor(prefix, offset) {
  const out = staffOf(prefix, 'outgoing_staff');
  const inc = staffOf(prefix, 'incoming_staff');
  return offset % 2 === 0
    ? { outgoing: out.slice(0, 3), incoming: inc.slice(3, 6) }
    : { outgoing: out.slice(3, 6), incoming: inc.slice(0, 3) };
}

async function insertSessionWithTimers(client, {
  userId, shiftId, startedAt, endedAt, endReason, timers = [],
}) {
  const { rows: [s] } = await client.query(
    'INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at) VALUES ($1, $2, $3, $4) RETURNING session_id',
    [userId, shiftId, startedAt, endReason === 'shift_end' ? new Date(endedAt.getTime() - 30 * MIN) : endedAt],
  );
  // A timer needs an active session, so the session is ended afterwards.
  for (const t of timers) {
    await client.query(
      'INSERT INTO task_timer (session_id, task_id, user_id, started_at, stopped_at) VALUES ($1, $2, $3, $4, $5)',
      [s.session_id, t.taskId, userId, t.startedAt, t.stoppedAt],
    );
  }
  if (endedAt) {
    await client.query('UPDATE work_session SET ended_at = $2, end_reason = $3 WHERE session_id = $1', [s.session_id, endedAt, endReason]);
  }
  return s.session_id;
}

async function seed({ now = new Date(), log = console.log } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const client = await pool.connect();
  const counts = {
    shifts: 0, assignments: 0, records: 0, sessions: 0, timers: 0, reports: 0, notifications: 0,
  };
  try {
    await client.query('BEGIN');
    // TRUNCATE bypasses the row-level append-only/immutability triggers, which
    // is intended here: the seed rebuilds a disposable dev database.
    await client.query(`
      TRUNCATE push_subscription, task_timer, work_session, report_share, report_task, report, email_outbox, reminder_log, shift_assignment, message_read, message, access_request, audit_log, notification, supervisor_review, acknowledgement, incident,
               task, handover_record, shift, app_user, department, handover_template
      RESTART IDENTITY
    `);

    const deptIds = {};
    for (const d of DEPARTMENTS) {
      const { rows: [tpl] } = await client.query(
        `INSERT INTO handover_template (department_code, field_definition, version)
         VALUES ($1, $2, 1) RETURNING template_id`,
        [d.code, TEMPLATES[d.code]],
      );
      const { rows: [dept] } = await client.query(
        'INSERT INTO department (name, code, template_id) VALUES ($1, $2, $3) RETURNING department_id',
        [d.name, d.code, tpl.template_id],
      );
      deptIds[d.code] = dept.department_id;
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
    const userIds = {};
    for (const [staffNumber, fullName, deptCode, role] of USERS) {
      const { rows: [u] } = await client.query(
        `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id`,
        [staffNumber, fullName, emailFor(fullName), passwordHash, role, deptCode ? deptIds[deptCode] : null],
      );
      userIds[staffNumber] = u.user_id;
    }

    const shifts = shiftStarts(now);
    const shiftIds = {};
    for (const d of DEPARTMENTS) {
      shiftIds[d.code] = {};
      for (const s of shifts) {
        const { rows: [row] } = await client.query(
          'INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING shift_id',
          [deptIds[d.code], s.type, s.start, s.end],
        );
        shiftIds[d.code][s.offset] = row.shift_id;
        counts.shifts += 1;
        const { outgoing, incoming } = rosterFor(d.prefix, s.offset);
        for (const staff of [...outgoing, ...incoming]) {
          await client.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [row.shift_id, userIds[staff]]);
          counts.assignments += 1;
        }
      }
    }
    const current = shifts.find((s) => s.offset === 0);

    // The original sample: an acknowledged previous-shift Ground Ops record
    // with an open task, so submitting the current Ground Ops handover
    // demonstrates carry-forward.
    const { rows: [rec] } = await client.query(
      `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING record_id`,
      [
        shiftIds.ground_ops[-1], deptIds.ground_ops, userIds.KQ1001, userIds.KQ1002,
        'SYNTHETIC: Stands 4-7 cleared. GPU on stand 5 intermittent, engineering informed. Late inbound from DXB.',
      ],
    );
    await client.query(
      `INSERT INTO task (record_id, description, status, priority) VALUES
       ($1, 'SYNTHETIC: Replace faulty GPU cable on stand 5', 'open', 'high'),
       ($1, 'SYNTHETIC: Restock de-icing fluid log sheets', 'resolved', 'low')`,
      [rec.record_id],
    );
    await client.query(
      `INSERT INTO incident (record_id, title, description, severity, occurred_at, reported_by)
       VALUES ($1, 'SYNTHETIC: Baggage tug minor contact', 'SYNTHETIC: Tug made minor contact with cart, no aircraft involved.',
               'low', $2, $3)`,
      [rec.record_id, new Date(current.start.getTime() - 3 * HOUR), userIds.KQ1001],
    );
    // Walk the record through legal transitions (the DB trigger enforces order).
    await client.query(
      "UPDATE handover_record SET status = 'submitted', submitted_at = $2 WHERE record_id = $1",
      [rec.record_id, new Date(current.start.getTime() - 0.25 * HOUR)],
    );
    await client.query("UPDATE handover_record SET status = 'acknowledged' WHERE record_id = $1", [rec.record_id]);
    await client.query(
      `INSERT INTO acknowledgement (record_id, incoming_user_id, confirmed_at, comments)
       VALUES ($1, $2, $3, 'SYNTHETIC: Received, will chase GPU repair.')`,
      [rec.record_id, userIds.KQ1002, new Date(current.start.getTime() + 0.25 * HOUR)],
    );
    counts.records += 1;

    // Every other past shift: a record by the first rostered outgoing worker,
    // work sessions for all six rostered workers, two task timers for the
    // author, and the author's shift report shared with the first supervisor.
    for (const d of DEPARTMENTS) {
      const supervisor = userIds[`KQ${d.prefix}003`];
      for (const s of shifts.filter((x) => x.offset < 0)) {
        const shiftId = shiftIds[d.code][s.offset];
        const { outgoing, incoming } = rosterFor(d.prefix, s.offset);
        const author = userIds[outgoing[0]];
        const receiver = userIds[rosterFor(d.prefix, s.offset + 1).incoming[0]];
        const pick = (i) => TASKS[d.code][(Math.abs(s.offset) + i) % TASKS[d.code].length];
        const date = formatEAT(s.start, 'date');
        const label = `${s.type === 'day' ? 'Day' : 'Night'} shift`;

        let taskRows;
        if (d.code === 'ground_ops' && s.offset === -1) {
          taskRows = (await client.query('SELECT task_id, description, status FROM task WHERE record_id = $1 ORDER BY description', [rec.record_id])).rows;
        } else {
          const { rows: [r] } = await client.query(
            `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
             VALUES ($1, $2, $3, $4, $5) RETURNING record_id`,
            [shiftId, deptIds[d.code], author, receiver, `SYNTHETIC: ${label} ${date} handover for ${d.name}. Routine operations, no open safety items.`],
          );
          // Only the shift just before the current one leaves work open.
          ({ rows: taskRows } = await client.query(
            `INSERT INTO task (record_id, description, status, priority) VALUES
             ($1, $2, 'resolved', 'medium'), ($1, $3, $4, 'high') RETURNING task_id, description, status`,
            [r.record_id, `SYNTHETIC: ${pick(0)}`, `SYNTHETIC: ${pick(1)}`, s.offset === -1 ? 'open' : 'resolved'],
          ));
          await client.query(
            "UPDATE handover_record SET status = 'submitted', submitted_at = $2 WHERE record_id = $1",
            [r.record_id, new Date(s.end.getTime() - 20 * MIN)],
          );
          await client.query("UPDATE handover_record SET status = 'acknowledged' WHERE record_id = $1", [r.record_id]);
          await client.query(
            `INSERT INTO acknowledgement (record_id, incoming_user_id, confirmed_at, comments)
             VALUES ($1, $2, $3, 'SYNTHETIC: Received.')`,
            [r.record_id, receiver, new Date(s.end.getTime() + 15 * MIN)],
          );
          counts.records += 1;
        }

        // Sessions: most end by hand near the shift's end; one in six is ended
        // by the shift-end job and one by the heartbeat timeout.
        for (const [i, staff] of [...outgoing, ...incoming].entries()) {
          const startedAt = new Date(s.start.getTime() + (5 + 3 * i) * MIN);
          const endReason = i === 4 ? 'shift_end' : i === 5 ? 'heartbeat' : 'manual';
          const endedAt = endReason === 'shift_end'
            ? new Date(s.end.getTime() + 30 * MIN)
            : new Date(s.end.getTime() - (endReason === 'heartbeat' ? 3 * HOUR : (10 + i) * MIN));
          const timers = staff === outgoing[0] ? [
            { taskId: taskRows[0].task_id, startedAt: new Date(s.start.getTime() + 30 * MIN), stoppedAt: new Date(s.start.getTime() + 2 * HOUR) },
            { taskId: taskRows[1].task_id, startedAt: new Date(s.start.getTime() + 3 * HOUR), stoppedAt: new Date(s.start.getTime() + 4.5 * HOUR) },
          ] : [];
          await insertSessionWithTimers(client, {
            userId: userIds[staff], shiftId, startedAt, endedAt, endReason, timers,
          });
          counts.sessions += 1;
          counts.timers += timers.length;
        }

        // The author's shift report: drafted, linked to both tasks, submitted
        // and shared with the department's first supervisor.
        const open = taskRows.filter((t) => t.status !== 'resolved');
        const { rows: [report] } = await client.query(
          `INSERT INTO report (author_id, shift_id, title, done_text, pending_text, nothing_pending, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING report_id, title`,
          [
            author, shiftId, `SYNTHETIC: ${label} report ${date}`,
            `SYNTHETIC:\n${taskRows.filter((t) => t.status === 'resolved').map((t) => `- ${t.description}`).join('\n')}`,
            open.length ? `SYNTHETIC:\n${open.map((t) => `- ${t.description}`).join('\n')}` : '',
            open.length === 0, new Date(s.end.getTime() - 40 * MIN),
          ],
        );
        await client.query('INSERT INTO report_task (report_id, task_id) SELECT $1, unnest($2::uuid[])', [report.report_id, taskRows.map((t) => t.task_id)]);
        const submittedAt = new Date(s.end.getTime() - 25 * MIN);
        await client.query("UPDATE report SET status = 'submitted', submitted_at = $2 WHERE report_id = $1", [report.report_id, submittedAt]);
        // Shares and notifications older than the previous shift have been read.
        const readAt = s.offset < -1 ? new Date(s.end.getTime() + HOUR) : null;
        await client.query(
          'INSERT INTO report_share (report_id, user_id, shared_by, shared_at, read_at) VALUES ($1, $2, $3, $4, $5)',
          [report.report_id, supervisor, author, submittedAt, readAt],
        );
        // In-app only (IR-05: notify() is the only code that writes notifications).
        const [note] = await notify({
          userIds: [supervisor], type: 'report_shared', title: `Shift report shared with you: ${report.title}`, ref: { report_id: report.report_id }, at: submittedAt,
        }, { db: client });
        if (readAt) await client.query('UPDATE notification SET read_at = $2 WHERE notification_id = $1', [note.notification_id, readAt]);
        counts.reports += 1;
        counts.notifications += 1;
      }
    }

    // The current shift: two rostered workers per department are on shift
    // (session started, heartbeat now). With no client sending heartbeats the
    // session job ends them 10 minutes later, as it would for a closed tab.
    for (const d of DEPARTMENTS) {
      const { outgoing, incoming } = rosterFor(d.prefix, 0);
      for (const staff of [outgoing[1], incoming[0]]) {
        await client.query(
          'INSERT INTO work_session (user_id, shift_id, started_at, last_heartbeat_at) VALUES ($1, $2, $3, $4)',
          [userIds[staff], shiftIds[d.code][0], new Date(Math.min(now.getTime(), current.start.getTime() + 10 * MIN)), now],
        );
        counts.sessions += 1;
      }
    }

    await client.query('COMMIT');
    log('Seed complete (synthetic data).');
    log(`  ${DEPARTMENTS.length} departments, ${USERS.length} users, ${counts.shifts} shifts, ${counts.assignments} shift assignments,`);
    log(`  ${counts.records} handover records, ${counts.sessions} work sessions, ${counts.timers} task timers, ${counts.reports} reports, ${counts.notifications} notifications`);
    log(`  All accounts use password: ${DEMO_PASSWORD}`);
    log('  Staff numbers: KQd001-KQd003 and KQd004 (supervisor), KQd011-KQd015 (outgoing), KQd021-KQd025 (incoming) for d = 1-4; KQ9001 (admin)');
    return { users: USERS.length, ...counts };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  seed, USERS, ORIGINAL_USERS, DEMO_PASSWORD, DAYS_BACK,
};

if (require.main === module) {
  seed()
    .catch((err) => {
      console.error('Seed failed:', err.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

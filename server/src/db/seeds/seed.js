/**
 * Development seed for SHMS.
 *
 * ALL DATA IN THIS FILE IS SYNTHETIC. Names, staff numbers, emails and
 * operational details are invented for the prototype/demo and do not describe
 * real Kenya Airways staff, aircraft or events.
 *
 * Usage:  npm run seed
 * This wipes every SHMS table (TRUNCATE) and rebuilds the demo data set.
 * Refuses to run when NODE_ENV=production.
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

const DEMO_PASSWORD = 'Password123!';

const DEPARTMENTS = [
  { code: 'ground_ops', name: 'Ground Operations' },
  { code: 'maint', name: 'Aircraft Maintenance' },
  { code: 'cust_svc', name: 'Customer Service' },
  { code: 'flight_ops', name: 'Flight Operations' },
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

// Synthetic staff. One outgoing, one incoming and one supervisor per department,
// plus a single system administrator.
const USERS = [
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

const HOUR = 60 * 60 * 1000;

async function seed() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // TRUNCATE bypasses the row-level append-only/immutability triggers, which
    // is intended here: the seed rebuilds a disposable dev database.
    await client.query(`
      TRUNCATE access_request, audit_log, notification, supervisor_review, acknowledgement, incident,
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
        `INSERT INTO department (name, code, template_id) VALUES ($1, $2, $3) RETURNING department_id`,
        [d.name, d.code, tpl.template_id],
      );
      deptIds[d.code] = dept.department_id;
    }

    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
    const userIds = {};
    for (const [staffNumber, fullName, deptCode, role] of USERS) {
      const email = `${fullName.toLowerCase().replace(/[^a-z]+/g, '.')}@shms.example`;
      const { rows: [u] } = await client.query(
        `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING user_id`,
        [staffNumber, fullName, email, passwordHash, role, deptCode ? deptIds[deptCode] : null],
      );
      userIds[staffNumber] = u.user_id;
    }

    // Shifts: previous, current and next 12-hour shift for every department,
    // aligned to 06:00 / 18:00 Nairobi time so "current shift" always exists.
    const { start: curStart, type: curType } = currentShiftWindow(new Date());
    const shiftIds = {};
    for (const d of DEPARTMENTS) {
      shiftIds[d.code] = {};
      for (const [label, offset] of [['previous', -1], ['current', 0], ['next', 1]]) {
        const start = new Date(curStart.getTime() + offset * 12 * HOUR);
        const type = offset % 2 === 0 ? curType : (curType === 'day' ? 'night' : 'day');
        const { rows: [s] } = await client.query(
          `INSERT INTO shift (department_id, shift_type, start_time, end_time)
           VALUES ($1, $2, $3, $4) RETURNING shift_id`,
          [deptIds[d.code], type, start, new Date(start.getTime() + 12 * HOUR)],
        );
        shiftIds[d.code][label] = s.shift_id;
      }
    }

    // One sample record from the previous Ground Ops shift, already submitted
    // and acknowledged, with an open task so carry-forward can be demonstrated
    // when the current shift's handover is submitted.
    const { rows: [rec] } = await client.query(
      `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING record_id`,
      [
        shiftIds.ground_ops.previous, deptIds.ground_ops, userIds.KQ1001, userIds.KQ1002,
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
       VALUES ($1, 'SYNTHETIC: Baggage tug minor contact', 'Tug made minor contact with cart, no aircraft involved.',
               'low', $2, $3)`,
      [rec.record_id, new Date(curStart.getTime() - 3 * HOUR), userIds.KQ1001],
    );
    // Walk the record through legal transitions (the DB trigger enforces order).
    await client.query(
      `UPDATE handover_record SET status = 'submitted', submitted_at = $2 WHERE record_id = $1`,
      [rec.record_id, new Date(curStart.getTime() - 0.25 * HOUR)],
    );
    await client.query(`UPDATE handover_record SET status = 'acknowledged' WHERE record_id = $1`, [rec.record_id]);
    await client.query(
      `INSERT INTO acknowledgement (record_id, incoming_user_id, confirmed_at, comments)
       VALUES ($1, $2, $3, 'SYNTHETIC: Received, will chase GPU repair.')`,
      [rec.record_id, userIds.KQ1002, new Date(curStart.getTime() + 0.25 * HOUR)],
    );

    await client.query('COMMIT');
    console.log('Seed complete (synthetic data).');
    console.log(`  ${DEPARTMENTS.length} departments, ${USERS.length} users, ${DEPARTMENTS.length * 3} shifts, 1 sample record`);
    console.log(`  All accounts use password: ${DEMO_PASSWORD}`);
    console.log('  Staff numbers: ' + USERS.map(([s, , , r]) => `${s} (${r})`).join(', '));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

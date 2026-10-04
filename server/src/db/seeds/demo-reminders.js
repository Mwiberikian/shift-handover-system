/* eslint-disable no-console */
/**
 * npm run demo:reminders
 *
 * Creates a Ground Operations shift that started 5 minutes ago and ends in
 * about 35 minutes, with KQ1001 (outgoing) and KQ1002 (incoming) assigned, plus
 * the following shift with KQ1002 assigned, so the reminder scheduler can be
 * watched firing over the next hour. Because it starts most recently, it is
 * Ground Ops' "current shift" in the app, so submitting the handover from the
 * outgoing dashboard affects the later reminders as it would for real.
 *
 * Synthetic demo data only; run `npm run seed` first. Refuses NODE_ENV=production.
 */
require('dotenv').config({ quiet: true });
const pool = require('../../config/db');
const { hhmm, reminderConfig } = require('../../jobs/reminders');

const MIN = 60 * 1000;
const NAIROBI_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', hour: 'numeric', hourCycle: 'h23' });

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to create demo shifts in production');
  const c = reminderConfig();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [dept] } = await client.query("SELECT department_id, name FROM department WHERE code = 'ground_ops'");
    const { rows: people } = await client.query("SELECT user_id, staff_number, full_name FROM app_user WHERE staff_number IN ('KQ1001', 'KQ1002', 'KQ1003')");
    const by = Object.fromEntries(people.map((p) => [p.staff_number, p]));
    if (!dept || !by.KQ1001 || !by.KQ1002) throw new Error('Ground Operations / KQ1001 / KQ1002 not found. Run `npm run seed` first.');

    const now = Date.now();
    const start = new Date(now - 5 * MIN);
    const end = new Date(now + 35 * MIN);
    const nextEnd = new Date(end.getTime() + 12 * 60 * MIN);
    const typeAt = (d) => {
      const h = Number(NAIROBI_HOUR.format(d));
      return h >= 6 && h < 18 ? 'day' : 'night';
    };

    const { rows: [demo] } = await client.query(
      'INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING shift_id',
      [dept.department_id, typeAt(start), start, end],
    );
    const { rows: [following] } = await client.query(
      'INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING shift_id',
      [dept.department_id, typeAt(end), end, nextEnd],
    );
    await client.query(
      'INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2), ($1, $3), ($4, $3)',
      [demo.shift_id, by.KQ1001.user_id, by.KQ1002.user_id, following.shift_id],
    );
    await client.query('COMMIT');

    const t = (mins) => hhmm(new Date(now + mins * MIN));
    const endIn = 35;
    console.log(`Demo shift created for ${dept.name}: ${hhmm(start)} - ${hhmm(end)} (Nairobi), KQ1001 and KQ1002 assigned.`);
    console.log(`Following shift ${hhmm(end)} - ${hhmm(nextEnd)} with KQ1002 assigned.\n`);
    console.log('With the API running (npm run dev), expect in the notification bell:');
    console.log(`  ${t(endIn - c.shiftStart)}  KQ1002  "Shift starting soon" (following shift)`);
    console.log(`  ${t(endIn - c.handoverDueFirst)}  KQ1001  "Handover due soon" (if not yet submitted)`);
    console.log(`  ${t(endIn - c.handoverDueFinal)}  KQ1001  "Handover due now" (if not yet submitted)`);
    console.log(`  ${t(endIn)}  KQ1003  "Shift ended without a handover" (if none was submitted)`);
    console.log('If KQ1001 submits the handover with KQ1002 as the incoming staff member:');
    console.log(`  ${t(endIn + c.ackPending)}  KQ1002  "Handover awaiting your acknowledgement" (if still not acknowledged)`);
    console.log(`  ${t(endIn + c.unackAlert)}  KQ1003  "Handover not acknowledged" (if still not acknowledged)`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('demo:reminders failed:', err.message);
  process.exitCode = 1;
});

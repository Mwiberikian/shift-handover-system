// Builds past handover records with content for the assistant tests.
const { pool, tokenFor } = require('./fixtures');

const HOUR = 3600 * 1000;

async function addUser(world, key, staff, dept) {
  const { rows: [u] } = await pool.query(
    `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
     VALUES ($1, $2, $3, 'x', 'outgoing_staff', $4) RETURNING *`,
    [staff, `Test ${key}`, `${key.toLowerCase()}@test.example`, world.depts[dept].department_id],
  );
  world.users[key] = u;
  world.tokens[key] = tokenFor(u);
  return u;
}

// A record on its own past shift that ended `endedHoursAgo` hours ago.
// tasks: [{ description, priority, status, carried_from }] (carried_from is a task_id)
async function makeRecord(world, {
  dept = 'dept_a', author = 'outA', incoming = 'incA', endedHoursAgo = 20, status = 'submitted',
  summary = 'Previous shift summary for testing purposes', tasks = [], incidents = [], shiftType = 'current',
}) {
  const end = new Date(Date.now() - endedHoursAgo * HOUR);
  const start = new Date(end.getTime() - 12 * HOUR);
  const { rows: [shift] } = await pool.query(
    'INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING *',
    [world.depts[dept].department_id, shiftType, start, end],
  );
  const { rows: [record] } = await pool.query(
    `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [shift.shift_id, world.depts[dept].department_id, world.users[author].user_id, world.users[incoming].user_id, summary],
  );
  const taskRows = [];
  for (const t of tasks) {
    const { rows: [row] } = await pool.query(
      'INSERT INTO task (record_id, description, status, priority, carried_from_task_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [record.record_id, t.description, t.status || 'open', t.priority || 'medium', t.carried_from || null],
    );
    taskRows.push(row);
  }
  for (const i of incidents) {
    await pool.query(
      'INSERT INTO incident (record_id, title, description, severity, occurred_at, reported_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [record.record_id, i.title, i.description || null, i.severity, start, world.users[author].user_id],
    );
  }
  const path = {
    draft: [], submitted: ['submitted'], queried: ['submitted', 'queried'], acknowledged: ['submitted', 'acknowledged'], closed: ['submitted', 'acknowledged', 'closed'],
  }[status];
  for (const s of path) {
    await pool.query(
      'UPDATE handover_record SET status = $2, submitted_at = COALESCE(submitted_at, $3) WHERE record_id = $1',
      [record.record_id, s, new Date(end.getTime() - 5 * 60 * 1000)],
    );
  }
  return { record, shift, tasks: taskRows };
}

module.exports = { makeRecord, addUser, HOUR };

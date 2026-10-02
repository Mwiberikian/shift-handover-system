// Builds a fresh, synthetic world for each test: two departments with a
// template, one user per role, and a previous + current shift.
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../src/app');
const pool = require('../../src/config/db');
const { BCRYPT_ROUNDS } = require('../../src/config/constants');
const { currentShiftWindow } = require('../../src/utils/shiftWindow');

const PASSWORD = 'Password123!';
const HOUR = 3600 * 1000;

const TEMPLATE = {
  fields: [
    { key: 'summary_notes', label: 'Shift summary', type: 'text', required: true, minLength: 20 },
    { key: 'tasks', label: 'Outstanding tasks', type: 'list', required: true, minItems: 1 },
    { key: 'incidents', label: 'Incidents', type: 'list', required: false },
  ],
};

let passwordHash;

async function resetDb() {
  await pool.query(`
    TRUNCATE audit_log, notification, supervisor_review, acknowledgement, incident,
             task, handover_record, shift, app_user, department, handover_template
    RESTART IDENTITY`);
}

const tokenFor = (u) => jwt.sign(
  { user_id: u.user_id, role: u.role, department_id: u.department_id },
  process.env.JWT_SECRET,
  { expiresIn: '30m' },
);

async function buildWorld() {
  await resetDb();
  passwordHash ??= await bcrypt.hash(PASSWORD, BCRYPT_ROUNDS);
  const { start } = currentShiftWindow(new Date());
  const world = { depts: {}, users: {}, shifts: {}, tokens: {} };

  for (const code of ['dept_a', 'dept_b']) {
    const { rows: [tpl] } = await pool.query(
      `INSERT INTO handover_template (department_code, field_definition) VALUES ($1, $2) RETURNING *`,
      [code, TEMPLATE],
    );
    const { rows: [dept] } = await pool.query(
      `INSERT INTO department (name, code, template_id) VALUES ($1, $2, $3) RETURNING *`,
      [`Department ${code}`, code, tpl.template_id],
    );
    world.depts[code] = dept;
    world.shifts[code] = {};
    for (const [label, offset] of [['previous', -1], ['current', 0]]) {
      const s = new Date(start.getTime() + offset * 12 * HOUR);
      const { rows: [shift] } = await pool.query(
        `INSERT INTO shift (department_id, shift_type, start_time, end_time) VALUES ($1, $2, $3, $4) RETURNING *`,
        [dept.department_id, label === 'current' ? 'current' : 'previous', s, new Date(s.getTime() + 12 * HOUR)],
      );
      world.shifts[code][label] = shift;
    }
  }

  const people = [
    ['outA', 'T100', 'dept_a', 'outgoing_staff'],
    ['incA', 'T101', 'dept_a', 'incoming_staff'],
    ['supA', 'T102', 'dept_a', 'supervisor'],
    ['outB', 'T200', 'dept_b', 'outgoing_staff'],
    ['incB', 'T201', 'dept_b', 'incoming_staff'],
    ['supB', 'T202', 'dept_b', 'supervisor'],
    ['admin', 'T900', null, 'admin'],
  ];
  for (const [key, staff, dept, role] of people) {
    const { rows: [u] } = await pool.query(
      `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [staff, `Test ${key}`, `${key.toLowerCase()}@test.example`, passwordHash, role, dept && world.depts[dept].department_id],
    );
    world.users[key] = u;
    world.tokens[key] = tokenFor(u);
  }
  return world;
}

// Supertest request with the given user's bearer token.
function as(world, userKey) {
  const auth = (r) => r.set('Authorization', `Bearer ${world.tokens[userKey]}`);
  return {
    get: (url) => auth(request(app).get(url)),
    post: (url, body) => auth(request(app).post(url)).send(body ?? {}),
    patch: (url, body) => auth(request(app).patch(url)).send(body ?? {}),
    put: (url, body) => auth(request(app).put(url)).send(body ?? {}),
    delete: (url) => auth(request(app).delete(url)),
  };
}

// Creates a draft in dept_a's current shift that satisfies the template.
async function createCompleteDraft(world) {
  const out = as(world, 'outA');
  const { body: record } = await out.post('/api/handovers', {
    summary_notes: 'All stands clear, two late arrivals handled.',
    incoming_user_id: world.users.incA.user_id,
  });
  await out.post(`/api/handovers/${record.record_id}/tasks`, { description: 'Check GPU on stand 5', priority: 'high' });
  return record;
}

async function submitCompleteRecord(world) {
  const record = await createCompleteDraft(world);
  const res = await as(world, 'outA').post(`/api/handovers/${record.record_id}/submit`);
  if (res.status !== 200) throw new Error(`fixture submit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// Inserts a record directly in the DB and walks it through legal transitions
// to `status` (used to set up a "previous shift" record).
async function insertRecordWithStatus(world, { dept = 'dept_a', shift = 'previous', status, tasks = [] }) {
  const out = dept === 'dept_a' ? world.users.outA : world.users.outB;
  const inc = dept === 'dept_a' ? world.users.incA : world.users.incB;
  const { rows: [rec] } = await pool.query(
    `INSERT INTO handover_record (shift_id, department_id, outgoing_user_id, incoming_user_id, summary_notes)
     VALUES ($1, $2, $3, $4, 'Previous shift summary for testing purposes') RETURNING *`,
    [world.shifts[dept][shift].shift_id, world.depts[dept].department_id, out.user_id, inc.user_id],
  );
  const insertedTasks = [];
  for (const t of tasks) {
    const { rows: [task] } = await pool.query(
      'INSERT INTO task (record_id, description, status, priority) VALUES ($1, $2, $3, $4) RETURNING *',
      [rec.record_id, t.description, t.status, t.priority || 'medium'],
    );
    insertedTasks.push(task);
  }
  const path = {
    draft: [], submitted: ['submitted'], acknowledged: ['submitted', 'acknowledged'],
    closed: ['submitted', 'acknowledged', 'closed'],
  }[status];
  for (const s of path) {
    await pool.query(
      `UPDATE handover_record SET status = $2, submitted_at = COALESCE(submitted_at, now()) WHERE record_id = $1`,
      [rec.record_id, s],
    );
  }
  return { record: rec, tasks: insertedTasks };
}

const getRecordRow = async (id) => (await pool.query('SELECT * FROM handover_record WHERE record_id = $1', [id])).rows[0];

module.exports = {
  PASSWORD, TEMPLATE, pool, app, resetDb, buildWorld, as, tokenFor,
  createCompleteDraft, submitCompleteRecord, insertRecordWithStatus, getRecordRow,
};

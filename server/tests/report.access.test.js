// Part L5: reports end to end - the access matrix, immutability after an API
// submit (including direct SQL), the share rules, and what a share email
// says. (Downloads, CSV injection, the export cap and the rate limit are in
// report.download.test.js; the triggers on raw rows in report.schema.test.js.)
const {
  pool, buildWorld, as, tokenFor, insertRecordWithStatus,
} = require('./helpers/fixtures');
const { processOutbox } = require('../src/modules/notifications/email/outbox');
const { setTransport } = require('../src/modules/notifications/email/mailer');
const { downloadLimitStore } = require('../src/modules/reports/reports.routes');
const logger = require('../src/utils/logger');

const DONE = 'SECRET-DONE: replaced the hydraulic seal on tug 7 and logged it.';
const PENDING = 'SECRET-PENDING: baggage belt 2 sensor still faulty.';
const APP_URL = 'https://shms.test.example';

let world;
let report;
beforeEach(async () => {
  world = await buildWorld();
  downloadLimitStore.resetAll();
  // A second outgoing worker in dept_a: same department, not a recipient.
  const { rows: [peer] } = await pool.query(
    `INSERT INTO app_user (staff_number, full_name, email, password_hash, role, department_id)
     SELECT 'T103', 'Test peerA', 'peera@test.example', password_hash, 'outgoing_staff', department_id FROM app_user WHERE staff_number = 'T100'
     RETURNING *`,
  );
  world.users.peerA = peer;
  world.tokens.peerA = tokenFor(peer);

  // outA writes and submits a report and shares it with incA.
  await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [world.shifts.dept_a.current.shift_id, world.users.outA.user_id]);
  const { body: d } = await as(world, 'outA').post('/api/reports');
  await as(world, 'outA').patch(`/api/reports/${d.report_id}`, { title: 'Night summary', done_text: DONE, pending_text: PENDING, nothing_pending: false });
  report = (await as(world, 'outA').post(`/api/reports/${d.report_id}/submit`)).body;
  await as(world, 'outA').post(`/api/reports/${report.report_id}/share`, { user_ids: [world.users.incA.user_id] });
});
afterAll(() => pool.end());

describe('access matrix (submitted report by outA, shared with incA)', () => {
  // who: [read, PDF, in their default list views, may share]
  const MATRIX = {
    outA: { label: 'author', read: 200, pdf: 200, share: 200 },
    incA: { label: 'recipient', read: 200, pdf: 200, share: 403 },
    peerA: { label: 'another worker in the department', read: 403, pdf: 403, share: 403 },
    supA: { label: 'the department\'s supervisor', read: 200, pdf: 200, share: 200 },
    supB: { label: 'another department\'s supervisor', read: 403, pdf: 403, share: 403 },
    admin: { label: 'admin', read: 200, pdf: 200, share: 200 },
  };

  test.each(Object.entries(MATRIX))('%s', async (who, expected) => {
    const api = as(world, who);
    expect((await api.get(`/api/reports/${report.report_id}`)).status).toBe(expected.read);
    expect((await api.get(`/api/reports/${report.report_id}/download?format=pdf`)).status).toBe(expected.pdf);
    // Sharing is tried with someone every sharer may reach: supB.
    const target = who === 'supB' ? world.users.supA : world.users.supB;
    expect((await api.post(`/api/reports/${report.report_id}/share`, { user_ids: [target.user_id] })).status).toBe(expected.share);
    // Nobody but the author may edit or submit, and not even the author once submitted.
    expect((await api.patch(`/api/reports/${report.report_id}`, { title: 'Changed' })).status).toBe(who === 'outA' ? 409 : 403);
    expect((await api.post(`/api/reports/${report.report_id}/submit`)).status).toBe(who === 'outA' ? 409 : 403);
  });

  test('list scopes show it to exactly the right people', async () => {
    const ids = async (who, scope) => {
      const res = await as(world, who).get(`/api/reports?scope=${scope}`);
      return res.status === 200 ? res.body.items.map((r) => r.report_id) : res.status;
    };
    expect(await ids('outA', 'mine')).toEqual([report.report_id]);
    expect(await ids('incA', 'shared')).toEqual([report.report_id]);
    expect(await ids('peerA', 'mine')).toEqual([]);
    expect(await ids('peerA', 'shared')).toEqual([]);
    expect(await ids('peerA', 'department')).toBe(403);
    expect(await ids('supA', 'department')).toEqual([report.report_id]);
    expect(await ids('supB', 'department')).toEqual([]);
    expect(await ids('admin', 'department')).toEqual([report.report_id]);
  });

  test('a draft is visible to its author only, even to the supervisor and admin', async () => {
    await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [world.shifts.dept_a.current.shift_id, world.users.peerA.user_id]);
    const { body: d } = await as(world, 'peerA').post('/api/reports');
    for (const who of ['outA', 'incA', 'supA', 'admin']) {
      expect((await as(world, who).get(`/api/reports/${d.report_id}`)).status).toBe(403);
      expect((await as(world, who).get(`/api/reports/${d.report_id}/download?format=pdf`)).status).toBe(403);
    }
    expect((await as(world, 'admin').get('/api/reports?scope=department')).body.items.map((r) => r.report_id)).toEqual([report.report_id]);
  });
});

describe('immutability after submit', () => {
  const sqlError = async (sql, params) => {
    try {
      await pool.query(sql, params);
    } catch (err) {
      return err;
    }
    return null;
  };

  test('direct SQL cannot change, delete or relink a submitted report, nor unshare it', async () => {
    // A second report, submitted through the API with one linked task (and a
    // second task left unlinked, to try to add after the fact).
    const { tasks: [linked, spare] } = await insertRecordWithStatus(world, {
      shift: 'current', status: 'draft', tasks: [{ description: 'Synthetic linked task', status: 'open' }, { description: 'Synthetic spare task', status: 'open' }],
    });
    await pool.query('INSERT INTO shift_assignment (shift_id, user_id) VALUES ($1, $2)', [world.shifts.dept_a.current.shift_id, world.users.peerA.user_id]);
    const peer = as(world, 'peerA');
    const { body: d } = await peer.post('/api/reports');
    await peer.patch(`/api/reports/${d.report_id}`, {
      title: 'Peer summary', done_text: DONE, pending_text: PENDING, nothing_pending: false, task_ids: [linked.task_id],
    });
    expect((await peer.post(`/api/reports/${d.report_id}/submit`)).status).toBe(200);
    await peer.post(`/api/reports/${d.report_id}/share`, { user_ids: [world.users.supA.user_id] });
    const id = d.report_id;

    for (const [sql, params] of [
      ['UPDATE report SET done_text = $2 WHERE report_id = $1', [id, 'Rewritten after the fact by SQL.']],
      ["UPDATE report SET status = 'draft', submitted_at = NULL WHERE report_id = $1", [id]],
      ['UPDATE report SET title = title WHERE report_id = $1', [id]],
      ['DELETE FROM report WHERE report_id = $1', [id]],
      ['DELETE FROM report_task WHERE report_id = $1', [id]],
      ['INSERT INTO report_task (report_id, task_id) VALUES ($1, $2)', [id, spare.task_id]],
      ['DELETE FROM report_share WHERE report_id = $1', [id]],
      ['UPDATE report_share SET user_id = $2 WHERE report_id = $1', [id, world.users.supB.user_id]],
    ]) {
      expect({ sql, code: (await sqlError(sql, params))?.code }).toEqual({ sql, code: 'P0001' });
    }
    const read = await peer.get(`/api/reports/${id}`);
    expect(read.body).toMatchObject({
      status: 'submitted', title: 'Peer summary', done_text: DONE, pending_text: PENDING,
    });
    expect(read.body.tasks.map((t) => t.task_id)).toEqual([linked.task_id]);
    expect(read.body.shares.map((s) => s.user_id)).toEqual([world.users.supA.user_id]);
  });
});

describe('share rules', () => {
  const share = (who, userIds, extra = {}) => as(world, who).post(`/api/reports/${report.report_id}/share`, { user_ids: userIds, ...extra });

  test('workers: colleagues in their department and supervisors of any department, nobody else', async () => {
    expect((await share('outA', [world.users.peerA.user_id])).status).toBe(200);
    expect((await share('outA', [world.users.supB.user_id])).status).toBe(200);
    for (const other of ['outB', 'incB', 'admin']) {
      const res = await share('outA', [world.users[other].user_id]);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('You can share only with colleagues in your department and with supervisors');
    }
    // One refused recipient refuses the whole request.
    expect((await share('outA', [world.users.supA.user_id, world.users.outB.user_id])).status).toBe(400);
    expect((await pool.query('SELECT 1 FROM report_share WHERE user_id = $1', [world.users.supA.user_id])).rows).toHaveLength(0);
  });

  test('supervisors and admins: any active user; never the author or an inactive account', async () => {
    expect((await share('supA', [world.users.outB.user_id, world.users.admin.user_id])).status).toBe(200);
    expect((await share('admin', [world.users.incB.user_id])).status).toBe(200);
    expect((await share('supA', [world.users.outA.user_id])).status).toBe(400);
    await pool.query('UPDATE app_user SET is_active = false WHERE user_id = $1', [world.users.peerA.user_id]);
    expect((await share('supA', [world.users.peerA.user_id])).status).toBe(400);
  });

  test('a recipient cannot pass it on; nobody can share an unknown report', async () => {
    expect((await share('incA', [world.users.supA.user_id])).status).toBe(403);
    expect((await as(world, 'outA').post('/api/reports/00000000-0000-4000-8000-000000000000/share', { user_ids: [world.users.supA.user_id] })).status).toBe(404);
  });

  test('bad requests are 400', async () => {
    expect((await share('outA', [])).status).toBe(400);
    expect((await share('outA', ['nope'])).status).toBe(400);
    expect((await share('outA', [world.users.supA.user_id], { email: 'yes' })).status).toBe(400);
  });
});

describe('share email', () => {
  let saved;
  let sent;
  beforeEach(() => {
    saved = { ...process.env };
    Object.assign(process.env, { EMAIL_ENABLED: 'true', EMAIL_ALLOWED_DOMAINS: 'test.example', APP_URL });
    sent = [];
    setTransport({ sendMail: async (m) => { sent.push(m); return { messageId: 'x' }; } });
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = saved;
    setTransport(null);
    jest.restoreAllMocks();
  });

  test('carries the title and a link only, never the report text', async () => {
    await as(world, 'outA').post(`/api/reports/${report.report_id}/share`, { user_ids: [world.users.supA.user_id], email: true });
    await processOutbox({ now: new Date(Date.now() + 5000) });
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.to).toBe('supa@test.example');
    expect(mail.subject).toBe('[Shift Handover] Shift report shared with you: Night summary');
    expect(mail.text).toContain('Shift report shared with you: Night summary');
    expect(mail.text).toContain(APP_URL);
    const everything = JSON.stringify(mail);
    for (const secret of ['SECRET-DONE', 'SECRET-PENDING', 'hydraulic', 'baggage belt', report.report_id]) expect(everything).not.toContain(secret);
  });

  test('no email unless the sharer asks for one', async () => {
    await as(world, 'outA').post(`/api/reports/${report.report_id}/share`, { user_ids: [world.users.supA.user_id] });
    await processOutbox({ now: new Date(Date.now() + 5000) });
    expect(sent).toHaveLength(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM notification WHERE type = 'report_shared' AND recipient_id = $1", [world.users.supA.user_id])).rows[0].n).toBe(1);
  });
});

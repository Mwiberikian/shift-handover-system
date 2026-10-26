// Handover assistant (Part S): endpoints, access rules and what they never do.
const {
  pool, buildWorld, as, createCompleteDraft,
} = require('./helpers/fixtures');
const { makeRecord, addUser } = require('./helpers/assistantFixtures');
const assistant = require('../src/modules/assistant/assistant.service');

let world;
beforeEach(async () => {
  world = await buildWorld();
  await addUser(world, 'outA2', 'T110', 'dept_a');
  assistant.clearCache();
});
afterAll(() => pool.end());

const counts = async () => (await pool.query(
  `SELECT (SELECT count(*) FROM handover_record) AS r, (SELECT count(*) FROM task) AS t, (SELECT count(*) FROM incident) AS i,
          (SELECT count(*) FROM audit_log) AS a, (SELECT count(*) FROM notification) AS n`,
)).rows[0];

describe('access', () => {
  test('unauthenticated callers are refused', async () => {
    const request = require('supertest');
    const app = require('../src/app');
    expect((await request(app).get('/api/assistant/attention')).status).toBe(401);
  });

  test.each([
    ['attention', 'GET', '/api/assistant/attention', { supA: 200, admin: 200, outA: 403, incA: 403 }],
    ['recurring', 'GET', '/api/assistant/recurring', { supA: 200, admin: 200, outA: 403, incA: 403 }],
    ['search', 'GET', '/api/assistant/search?q=hydraulic', { supA: 200, admin: 200, outA: 403, incA: 403 }],
    ['stats', 'GET', '/api/assistant/stats', { supA: 200, admin: 200, outA: 403, incA: 403 }],
  ])('%s: role matrix', async (_n, method, url, expected) => {
    for (const [who, status] of Object.entries(expected)) {
      // eslint-disable-next-line no-await-in-loop
      const res = await as(world, who)[method.toLowerCase()](url);
      expect([who, res.status]).toEqual([who, status]);
    }
  });

  test('a supervisor cannot ask about another department; an admin can', async () => {
    const other = world.depts.dept_b.department_id;
    expect((await as(world, 'supA').get(`/api/assistant/attention?department_id=${other}`)).status).toBe(403);
    expect((await as(world, 'supA').get(`/api/assistant/search?q=hydraulic&department_id=${other}`)).status).toBe(403);
    expect((await as(world, 'admin').get(`/api/assistant/attention?department_id=${other}`)).status).toBe(200);
  });

  test('draft endpoints belong to the draft’s author only', async () => {
    const draft = await createCompleteDraft(world);
    for (const path of ['check', 'recurring', 'suggestions']) {
      const url = `/api/assistant/handovers/${draft.record_id}/${path}`;
      // eslint-disable-next-line no-await-in-loop
      expect((await as(world, 'outA').get(url)).status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      expect((await as(world, 'outA2').get(url)).status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      expect((await as(world, 'incA').get(url)).status).toBe(403);
      // eslint-disable-next-line no-await-in-loop
      expect((await as(world, 'supA').get(url)).status).toBe(403);
    }
    expect((await as(world, 'outA').get('/api/assistant/handovers/00000000-0000-4000-8000-000000000000/check')).status).toBe(404);
    expect((await as(world, 'outA').get('/api/assistant/handovers/not-a-uuid/check')).status).toBe(400);
  });

  test('can be switched off', async () => {
    process.env.ASSISTANT_ENABLED = 'false';
    try {
      expect((await as(world, 'supA').get('/api/assistant/config')).body).toEqual({ enabled: false });
      expect((await as(world, 'supA').get('/api/assistant/attention')).status).toBe(404);
    } finally { delete process.env.ASSISTANT_ENABLED; }
    expect((await as(world, 'supA').get('/api/assistant/config')).body).toEqual({ enabled: true });
  });
});

describe('quality check', () => {
  test('reads a real draft, flags what is wrong, and changes nothing', async () => {
    const out = as(world, 'outA');
    const { body: rec } = await out.post('/api/handovers', { summary_notes: 'Quiet shift.', incoming_user_id: world.users.incA.user_id });
    await out.post(`/api/handovers/${rec.record_id}/tasks`, { description: 'Order stationery for the office', priority: 'low' });
    await out.post(`/api/handovers/${rec.record_id}/incidents`, {
      title: 'Hydraulic leak on stand 4', severity: 'critical', occurred_at: new Date().toISOString(),
    });
    const before = await counts();
    const res = await out.get(`/api/assistant/handovers/${rec.record_id}/check`);
    expect(res.status).toBe(200);
    const codes = res.body.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(['summary_short', 'incident_no_action', 'summary_omits_incident', 'critical_without_high_task']));
    expect(res.body.ready).toBe(false);
    expect(await counts()).toEqual(before);
  });

  test('flags a task carried over several shifts in a row', async () => {
    let prev = null;
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await makeRecord(world, { endedHoursAgo: 100 - i * 24, status: 'closed', tasks: [{ description: 'Chase the spare seal order from stores', carried_from: prev }] });
      prev = r.tasks[0].task_id;
    }
    const out = as(world, 'outA');
    const { body: rec } = await out.post('/api/handovers', { summary_notes: 'Busy shift, all departures handled and the next team briefed.', incoming_user_id: world.users.incA.user_id });
    expect(rec.record_id).toBeDefined();
    await pool.query('INSERT INTO task (record_id, description, carried_from_task_id) VALUES ($1, $2, $3)', [rec.record_id, 'Chase the spare seal order from stores', prev]);
    const res = await out.get(`/api/assistant/handovers/${rec.record_id}/check`);
    expect(res.body.flags.map((f) => f.code)).toContain('stale_carry');
    expect(res.body.flags.find((f) => f.code === 'stale_carry').message).toMatch(/4 shifts/);
  });
});

describe('recurring issues', () => {
  async function history() {
    // Two records by outA, one by outA2: the same hydraulic problem each time.
    await makeRecord(world, { author: 'outA', endedHoursAgo: 80, tasks: [{ description: 'Hydraulic leak on stand 4, seal replacement needed' }] });
    await makeRecord(world, { author: 'outA', endedHoursAgo: 56, tasks: [{ description: 'hyd leaking at stand 4 inspect seals' }] });
    await makeRecord(world, { author: 'outA2', endedHoursAgo: 32, tasks: [{ description: 'Hydraulic leak by stand 4 aircraft again' }] });
  }

  test('the author sees earlier occurrences, but only their own handovers’ text', async () => {
    await history();
    const out = as(world, 'outA');
    const { body: rec } = await out.post('/api/handovers', { summary_notes: 'Busy shift, all departures handled and the next team briefed.', incoming_user_id: world.users.incA.user_id });
    await out.post(`/api/handovers/${rec.record_id}/tasks`, { description: 'Hydraulic leak at stand 4 aircraft, seal check' });
    const res = await out.get(`/api/assistant/handovers/${rec.record_id}/recurring`);
    expect(res.status).toBe(200);
    expect(res.body.recurring).toHaveLength(1);
    expect(res.body.recurring[0].occurrences).toBe(4);
    const matches = res.body.recurring[0].matches;
    expect(matches.filter((m) => m.hidden)).toHaveLength(1); // outA2's record
    expect(matches.filter((m) => m.hidden).every((m) => m.text === null)).toBe(true);
    expect(matches.filter((m) => !m.hidden).every((m) => typeof m.text === 'string')).toBe(true);
  });

  test('a supervisor sees department clusters; another department sees none of it', async () => {
    await history();
    await makeRecord(world, { author: 'outA', endedHoursAgo: 8, tasks: [{ description: 'Hydraulic leak on stand 4 aircraft, again' }] });
    const res = await as(world, 'supA').get('/api/assistant/recurring');
    expect(res.status).toBe(200);
    expect(res.body.clusters.length).toBeGreaterThanOrEqual(1);
    expect(res.body.clusters[0].occurrences).toBeGreaterThanOrEqual(3);
    expect(res.body.clusters.every((c) => c.department_id === world.depts.dept_a.department_id)).toBe(true);
    expect((await as(world, 'supB').get('/api/assistant/recurring')).body.clusters).toEqual([]);
  });
});

describe('suggested tasks', () => {
  test('from the author’s own earlier handovers only', async () => {
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeRecord(world, { author: 'outA', endedHoursAgo: 100 - i * 12, tasks: [{ description: 'Check GPU on stand 5 before first departure', priority: 'high' }] });
    }
    const out = as(world, 'outA');
    const { body: rec } = await out.post('/api/handovers', { summary_notes: 'Busy shift, all departures handled and the next team briefed.', incoming_user_id: world.users.incA.user_id });
    const mine = await out.get(`/api/assistant/handovers/${rec.record_id}/suggestions`);
    expect(mine.body.suggestions).toHaveLength(1);
    expect(mine.body.suggestions[0]).toMatchObject({ text: 'Check GPU on stand 5 before first departure', priority: 'high', support: 4 });

    await out.post(`/api/handovers/${rec.record_id}/tasks`, { description: 'Check GPU on stand 5 before first departure' });
    expect((await out.get(`/api/assistant/handovers/${rec.record_id}/suggestions`)).body.suggestions).toEqual([]);

    // A colleague with no history of their own gets nothing from outA's history.
    const theirs = await makeRecord(world, { author: 'outA2', endedHoursAgo: 1, status: 'draft' });
    const o2 = await as(world, 'outA2').get(`/api/assistant/handovers/${theirs.record.record_id}/suggestions`);
    expect(o2.status).toBe(200);
    expect(o2.body.suggestions).toEqual([]);
  });
});

describe('severity suggestion', () => {
  test('withheld until the department has enough history, then offered with its basis', async () => {
    const out = as(world, 'outA');
    const none = await out.post('/api/assistant/severity', { title: 'Fire near stand 4' });
    expect(none.status).toBe(200);
    expect(none.body.available).toBe(false);

    const incidents = [];
    for (let i = 0; i < 20; i += 1) {
      incidents.push({ title: `Fire and smoke near stand ${i}`, severity: 'critical' });
      incidents.push({ title: `Minor cosmetic scuff on tractor ${i}`, severity: 'low' });
    }
    for (let k = 0; k < 4; k += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeRecord(world, { endedHoursAgo: 200 - k * 12, incidents: incidents.slice(k * 10, k * 10 + 10) });
    }
    assistant.clearCache();
    const res = await out.post('/api/assistant/severity', { title: 'Smoke and fire at the stand', description: '' });
    expect(res.body).toMatchObject({ available: true, severity: 'critical', trained_on: 40 });
    expect(res.body.confidence).toBeGreaterThan(0.5);

    // It is the department's own history: another department learns nothing from it.
    expect((await as(world, 'outB').post('/api/assistant/severity', { title: 'Smoke and fire at the stand' })).body.available).toBe(false);
  });

  test('input is validated and only the author role may ask', async () => {
    expect((await as(world, 'outA').post('/api/assistant/severity', { title: '' })).status).toBe(400);
    expect((await as(world, 'supA').post('/api/assistant/severity', { title: 'Fire' })).status).toBe(403);
  });

  test('supervisors can read the cross-validated accuracy; admins must name a department', async () => {
    expect((await as(world, 'supA').get('/api/assistant/severity/evaluation')).status).toBe(200);
    expect((await as(world, 'admin').get('/api/assistant/severity/evaluation')).status).toBe(400);
  });
});

describe('attention ranking', () => {
  test('orders by risk, shows the reasons, and leaves out drafts, closed and trouble-free records', async () => {
    const risky = await makeRecord(world, {
      endedHoursAgo: 6, status: 'submitted', summary: 'Hydraulic leak on stand 4 found and logged for the next team.',
      incidents: [{ title: 'Hydraulic leak on stand 4', severity: 'critical' }], tasks: [{ description: 'Replace hydraulic seal on stand 4 aircraft', priority: 'high' }],
    });
    const mild = await makeRecord(world, { endedHoursAgo: 30, status: 'submitted', tasks: [{ description: 'Collect spare radio batteries from stores', priority: 'high' }] });
    await makeRecord(world, { endedHoursAgo: 50, status: 'acknowledged' });
    await makeRecord(world, { endedHoursAgo: 70, status: 'closed', incidents: [{ title: 'Old fire alarm', severity: 'critical' }] });
    await makeRecord(world, { endedHoursAgo: 90, status: 'draft', incidents: [{ title: 'Draft incident', severity: 'critical' }] });
    await makeRecord(world, { dept: 'dept_b', author: 'outB', incoming: 'incB', endedHoursAgo: 6, status: 'submitted', incidents: [{ title: 'Other department fire', severity: 'critical' }] });

    const res = await as(world, 'supA').get('/api/assistant/attention');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i) => i.record_id)).toEqual([risky.record.record_id, mild.record.record_id]);
    expect(res.body.items[0].level).toBe('high');
    expect(res.body.items[0].reasons[0].code).toBe('incidents');
    expect(res.body.items[0].score).toBeGreaterThan(res.body.items[1].score);

    const all = await as(world, 'admin').get('/api/assistant/attention');
    expect(all.body.items.map((i) => i.department_name)).toContain('Department dept_b');
    expect(all.body.items).toHaveLength(3);
  });

  test('long-carried tasks raise a record’s score', async () => {
    let prev = null;
    for (let i = 0; i < 4; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await makeRecord(world, { endedHoursAgo: 300 - i * 24, status: 'closed', tasks: [{ description: 'Chase the spare seal order from stores', carried_from: prev }] });
      prev = r.tasks[0].task_id;
    }
    const stale = await makeRecord(world, { endedHoursAgo: 50, status: 'acknowledged', tasks: [{ description: 'Chase the spare seal order from stores', carried_from: prev }] });
    const res = await as(world, 'supA').get('/api/assistant/attention');
    const item = res.body.items.find((i) => i.record_id === stale.record.record_id);
    expect(item.reasons.map((r) => r.code)).toContain('stale_tasks');
    expect(item.flags.map((f) => f.code)).toContain('stale_carry');
  });

  test('an empty department answers an empty list', async () => {
    expect((await as(world, 'supB').get('/api/assistant/attention')).body).toEqual({ items: [] });
  });
});

describe('search by meaning', () => {
  test('finds by meaning inside the supervisor’s department only', async () => {
    const a = await makeRecord(world, { endedHoursAgo: 30, tasks: [{ description: 'Hydraulic leak on stand 4, seal replacement needed' }] });
    await makeRecord(world, { endedHoursAgo: 50, tasks: [{ description: 'Baggage belt jammed at gate 3' }] });
    await makeRecord(world, { dept: 'dept_b', author: 'outB', incoming: 'incB', endedHoursAgo: 30, tasks: [{ description: 'Hydraulic leak at stand 9' }] });
    const res = await as(world, 'supA').get('/api/assistant/search?q=hyd%20leaking');
    expect(res.status).toBe(200);
    expect(res.body.results.map((r) => r.record_id)).toEqual([a.record.record_id]);
    expect(res.body.results[0].snippet.text).toMatch(/Hydraulic/);
    expect((await as(world, 'admin').get('/api/assistant/search?q=hyd%20leaking')).body.results).toHaveLength(2);
    expect((await as(world, 'supA').get('/api/assistant/search?q=a')).status).toBe(400);
  });

  test('drafts are not searchable', async () => {
    await makeRecord(world, { endedHoursAgo: 30, status: 'draft', tasks: [{ description: 'Hydraulic leak on stand 4, seal replacement needed' }] });
    expect((await as(world, 'supA').get('/api/assistant/search?q=hydraulic%20leak')).body.results).toEqual([]);
  });
});

describe('digest', () => {
  test('summarises the latest ended shift of the department', async () => {
    await makeRecord(world, { endedHoursAgo: 40, status: 'closed' });
    await makeRecord(world, { endedHoursAgo: 2, status: 'submitted', incidents: [{ title: 'Fuel spill at stand 2', severity: 'critical' }], tasks: [{ description: 'Clean fuel spill at stand 2 and inspect hose', priority: 'high' }] });
    const res = await as(world, 'supA').get('/api/assistant/digest');
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toMatchObject({ submitted: 1, unacknowledged: 1, acknowledged: 0 });
    expect(res.body.data.incidents.critical).toBe(1);
    expect(res.body.headline).toMatch(/1 handover, 1 unacknowledged, 1 serious incident/);
    expect(res.body.lines.join(' ')).toMatch(/1 critical incident/);
  });

  test('a shift with no handover says so', async () => {
    const { shift } = await makeRecord(world, { endedHoursAgo: 2, status: 'draft' });
    const res = await as(world, 'supA').get(`/api/assistant/digest?shift_id=${shift.shift_id}`);
    expect(res.body.lines[0]).toBe('No handover was submitted for this shift.');
  });

  test('rules: admins name a department, other departments are refused, none ended is 404', async () => {
    expect((await as(world, 'admin').get('/api/assistant/digest')).status).toBe(400);
    const { shift } = await makeRecord(world, { endedHoursAgo: 2 });
    expect((await as(world, 'supB').get(`/api/assistant/digest?shift_id=${shift.shift_id}`)).status).toBe(403);
    const { rows: [d] } = await pool.query("INSERT INTO department (name, code) VALUES ('Empty department', 'empty') RETURNING department_id");
    expect((await as(world, 'admin').get(`/api/assistant/digest?department_id=${d.department_id}`)).status).toBe(404);
  });
});

describe('events and usage statistics', () => {
  test('logs what a person did with a suggestion, keeps only codes and numbers', async () => {
    const draft = await createCompleteDraft(world);
    const out = as(world, 'outA');
    const ok = await out.post('/api/assistant/events', {
      kind: 'flag_dismissed', record_id: draft.record_id, payload: { code: 'incident_no_action', nested: { text: 'secret handover text' }, count: 2 },
    });
    expect(ok.status).toBe(201);
    const { rows: [e] } = await pool.query('SELECT * FROM assistant_event');
    expect(e.payload).toEqual({ code: 'incident_no_action', count: 2 });
    expect(e.user_id).toBe(world.users.outA.user_id);
  });

  test('refuses unknown kinds, other people’s records and incoming staff', async () => {
    const draft = await createCompleteDraft(world);
    expect((await as(world, 'outA').post('/api/assistant/events', { kind: 'made_up' })).status).toBe(400);
    expect((await as(world, 'outA2').post('/api/assistant/events', { kind: 'flags_shown', record_id: draft.record_id })).status).toBe(403);
    expect((await as(world, 'incA').post('/api/assistant/events', { kind: 'flags_shown' })).status).toBe(403);
  });

  test('is append-only in the database', async () => {
    await as(world, 'outA').post('/api/assistant/events', { kind: 'flags_shown', payload: { n: 1 } });
    await expect(pool.query("UPDATE assistant_event SET kind = 'search_run'")).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM assistant_event')).rejects.toThrow(/append-only/);
  });

  test('statistics: acceptance and dismissal rates', async () => {
    const out = as(world, 'outA');
    for (const kind of ['suggestion_accepted', 'suggestion_accepted', 'suggestion_accepted', 'suggestion_dismissed', 'severity_accepted', 'severity_overridden', 'flags_shown', 'flags_shown', 'flag_dismissed']) {
      // eslint-disable-next-line no-await-in-loop
      await out.post('/api/assistant/events', { kind });
    }
    const res = await as(world, 'supA').get('/api/assistant/stats');
    expect(res.body.suggestion_acceptance).toBe(0.75);
    expect(res.body.severity_acceptance).toBe(0.5);
    expect(res.body.flag_dismissal).toBe(0.5);
    expect((await as(world, 'supB').get('/api/assistant/stats')).body.counts).toEqual({});
  });
});

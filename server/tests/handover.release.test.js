// Phase 2: automatic release of handover reports, with holds.
// Clean submissions auto-release; hold rules hold; a held report never blocks
// the incoming shift; supervisors approve or send back, scoped to their
// department; the AUTO_APPROVAL_ENABLED flag off holds everything.
const {
  pool, buildWorld, as, createCompleteDraft, getRecordRow,
} = require('./helpers/fixtures');

let world;
beforeEach(async () => { world = await buildWorld(); });
afterEach(() => {
  delete process.env.AUTO_APPROVAL_ENABLED;
  delete process.env.ASSISTANT_ENABLED;
});
afterAll(() => pool.end());

const submit = (record) => as(world, 'outA').post(`/api/handovers/${record.record_id}/submit`);
const notificationsFor = async (recordId) => (await pool.query(
  'SELECT recipient_id, type FROM notification WHERE record_id = $1 ORDER BY type',
  [recordId],
)).rows;
const auditFor = async (recordId, action) => (await pool.query(
  `SELECT * FROM audit_log WHERE entity_type = 'handover_record' AND entity_id = $1 AND action = $2`,
  [recordId, action],
)).rows;

// A draft whose summary satisfies the template but trips a hold keyword.
async function createHeldDraft(world2, summary = 'Routine shift overall but there was a fuel spill at stand 2 during refuelling.') {
  const draft = await createCompleteDraft(world2);
  await as(world2, 'outA').patch(`/api/handovers/${draft.record_id}`, { summary_notes: summary });
  return draft;
}

describe('submit with clean content auto-releases', () => {
  test('release_state, released_at, empty reasons, audit by the assistant', async () => {
    const draft = await createCompleteDraft(world);
    const res = await submit(draft);
    expect(res.status).toBe(200);
    expect(res.body.release_state).toBe('auto_released');
    expect(res.body.released_at).toBeTruthy();
    expect(res.body.release_reasons).toEqual([]);

    const [audit] = await auditFor(draft.record_id, 'auto_release');
    expect(audit).toBeTruthy();
    expect(audit.user_id).toBe(world.users.outA.user_id);
    expect(audit.new_value.by).toBe('assistant');
    expect(audit.new_value.release_state).toBe('auto_released');
    expect(await auditFor(draft.record_id, 'hold')).toEqual([]);
  });

  test('incoming person and supervisor are each notified exactly once (handover_submitted)', async () => {
    const draft = await createCompleteDraft(world);
    await submit(draft);
    const rows = await notificationsFor(draft.record_id);
    expect(rows).toEqual(expect.arrayContaining([
      { recipient_id: world.users.incA.user_id, type: 'handover_submitted' },
      { recipient_id: world.users.supA.user_id, type: 'handover_submitted' },
    ]));
    expect(rows).toHaveLength(2);
  });
});

describe('hold rules', () => {
  test.each(['high', 'critical'])('an incident with severity %s holds the report', async (severity) => {
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/incidents`, {
      title: 'Problem at the gate during boarding', severity, occurred_at: new Date().toISOString(),
    });
    const res = await submit(draft);
    expect(res.status).toBe(200);
    expect(res.body.release_state).toBe('held');
    expect(res.body.released_at).toBeNull();
    expect(res.body.release_reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'incident_severity', severity }),
    ]));
  });

  test('hazard wording in the summary holds, with the word named in the reasons', async () => {
    const draft = await createHeldDraft(world);
    const res = await submit(draft);
    expect(res.body.release_state).toBe('held');
    const texts = res.body.release_reasons.map((r) => r.text);
    expect(texts.some((t) => /contains the word '(fuel )?spill'/.test(t))).toBe(true);
  });

  test('hazard wording in a task description holds', async () => {
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/tasks`, {
      description: 'Clear the FOD found on stand 3 before the first departure',
    });
    const res = await submit(draft);
    expect(res.body.release_state).toBe('held');
    expect(res.body.release_reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'keyword', term: 'FOD' }),
    ]));
  });

  test('hazard wording in a low-severity incident holds', async () => {
    const draft = await createCompleteDraft(world);
    await as(world, 'outA').post(`/api/handovers/${draft.record_id}/incidents`, {
      title: 'Small hydraulic leak under the tug', severity: 'low', occurred_at: new Date().toISOString(),
    });
    const res = await submit(draft);
    expect(res.body.release_state).toBe('held');
  });

  test("negations still hold: 'no injuries' is conservative by design", async () => {
    const draft = await createHeldDraft(world, 'Calm shift with no injuries and nothing unusual to hand over tonight.');
    const res = await submit(draft);
    expect(res.body.release_state).toBe('held');
  });

  test('a hold writes an audit entry naming the assistant and the reasons', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);
    const [audit] = await auditFor(draft.record_id, 'hold');
    expect(audit.user_id).toBe(world.users.outA.user_id);
    expect(audit.new_value.by).toBe('assistant');
    expect(audit.new_value.reasons.length).toBeGreaterThan(0);
    expect(await auditFor(draft.record_id, 'auto_release')).toEqual([]);
  });

  test('on hold, the supervisor gets handover_held and the incoming person handover_submitted — one each', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);
    const rows = await notificationsFor(draft.record_id);
    expect(rows).toEqual(expect.arrayContaining([
      { recipient_id: world.users.incA.user_id, type: 'handover_submitted' },
      { recipient_id: world.users.supA.user_id, type: 'handover_held' },
    ]));
    expect(rows).toHaveLength(2);
  });

  test('a held notification is queued for email delivery', async () => {
    process.env.EMAIL_ENABLED = 'true';
    process.env.EMAIL_ALLOWED_DOMAINS = 'test.example';
    try {
      const draft = await createHeldDraft(world);
      await submit(draft);
      const { rows } = await pool.query(
        `SELECT o.subject FROM email_outbox o JOIN notification n USING (notification_id)
          WHERE n.record_id = $1 AND n.type = 'handover_held'`,
        [draft.record_id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toMatch(/held for your approval/);
    } finally {
      delete process.env.EMAIL_ENABLED;
      delete process.env.EMAIL_ALLOWED_DOMAINS;
    }
  });
});

describe('a held report never blocks the incoming person', () => {
  test('the incoming person sees the full held report with its reasons and can acknowledge it', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);

    const seen = await as(world, 'incA').get(`/api/handovers/${draft.record_id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.release_state).toBe('held');
    expect(seen.body.release_reasons.length).toBeGreaterThan(0);
    expect(seen.body.summary_notes).toMatch(/fuel spill/);

    const ack = await as(world, 'incA').post(`/api/handovers/${draft.record_id}/acknowledgement`, {});
    expect(ack.status).toBe(200);
    const row = await getRecordRow(draft.record_id);
    expect(row.status).toBe('acknowledged');
    expect(row.release_state).toBe('held'); // acknowledging does not approve
  });
});

describe('supervisor approve', () => {
  test('releases the report, records who approved and when, audits, and notifies', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);

    const res = await as(world, 'supA').post(`/api/handovers/${draft.record_id}/approve`, { comments: 'Spill contained, report fine.' });
    expect(res.status).toBe(200);
    expect(res.body.release_state).toBe('approved');
    expect(res.body.released_at).toBeTruthy();

    const [audit] = await auditFor(draft.record_id, 'approve_release');
    expect(audit.user_id).toBe(world.users.supA.user_id);
    expect(audit.new_value.approved_by).toBe(world.users.supA.user_id);
    expect(audit.new_value.approved_at).toBeTruthy();
    expect(audit.new_value.comments).toBe('Spill contained, report fine.');

    const rows = await notificationsFor(draft.record_id);
    expect(rows).toEqual(expect.arrayContaining([
      { recipient_id: world.users.incA.user_id, type: 'handover_approved' },
      { recipient_id: world.users.outA.user_id, type: 'handover_approved' },
    ]));
  });

  test('an admin can approve anywhere; a supervisor of another department cannot; staff cannot', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);

    expect((await as(world, 'supB').post(`/api/handovers/${draft.record_id}/approve`, {})).status).toBe(403);
    expect((await as(world, 'incA').post(`/api/handovers/${draft.record_id}/approve`, {})).status).toBe(403);
    expect((await as(world, 'outA').post(`/api/handovers/${draft.record_id}/approve`, {})).status).toBe(403);
    expect((await getRecordRow(draft.record_id)).release_state).toBe('held');

    const res = await as(world, 'admin').post(`/api/handovers/${draft.record_id}/approve`, {});
    expect(res.status).toBe(200);
    expect(res.body.release_state).toBe('approved');
  });

  test('approving a report that is not held is rejected with 409', async () => {
    const draft = await createCompleteDraft(world);
    await submit(draft); // auto-released
    const res = await as(world, 'supA').post(`/api/handovers/${draft.record_id}/approve`, {});
    expect(res.status).toBe(409);
  });
});

describe('supervisor send-back', () => {
  test('moves the report to queried with the note; clarify returns it, still held, then approve releases', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);

    const back = await as(world, 'supA').post(`/api/handovers/${draft.record_id}/send-back`, { comments: 'Name who contained the spill and when.' });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('queried');
    expect(back.body.release_state).toBe('held');

    const outgoingNote = await notificationsFor(draft.record_id);
    expect(outgoingNote).toEqual(expect.arrayContaining([
      { recipient_id: world.users.outA.user_id, type: 'handover_queried' },
    ]));

    const clarified = await as(world, 'outA').post(`/api/handovers/${draft.record_id}/clarify`, { comments: 'Contained by me at 14:10, fire crew confirmed.' });
    expect(clarified.status).toBe(200);
    const row = await getRecordRow(draft.record_id);
    expect(row.status).toBe('submitted');
    expect(row.release_state).toBe('held'); // clarifying never releases by itself

    expect((await as(world, 'supA').post(`/api/handovers/${draft.record_id}/approve`, {})).status).toBe(200);
  });

  test('requires a note, the right department and a held report', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);
    expect((await as(world, 'supA').post(`/api/handovers/${draft.record_id}/send-back`, {})).status).toBe(400);
    expect((await as(world, 'supB').post(`/api/handovers/${draft.record_id}/send-back`, { comments: 'x' })).status).toBe(403);

    // Once approved the report is no longer held, so send-back is rejected.
    await as(world, 'supA').post(`/api/handovers/${draft.record_id}/approve`, {});
    expect((await as(world, 'supA').post(`/api/handovers/${draft.record_id}/send-back`, { comments: 'too late' })).status).toBe(409);
  });
});

describe('AUTO_APPROVAL_ENABLED=false holds everything (safe behaviour)', () => {
  test('a clean submission is held, never released, and approve still works', async () => {
    process.env.AUTO_APPROVAL_ENABLED = 'false';
    const draft = await createCompleteDraft(world);
    const res = await submit(draft);
    expect(res.body.release_state).toBe('held');
    expect(res.body.release_reasons).toEqual([
      expect.objectContaining({ code: 'auto_approval_disabled' }),
    ]);
    // A supervisor can always approve, flag on or off.
    expect((await as(world, 'supA').post(`/api/handovers/${draft.record_id}/approve`, {})).status).toBe(200);
  });
});

describe('ASSISTANT_ENABLED=false holds everything (fail safe)', () => {
  test('a clean submission is held with the reason named', async () => {
    process.env.ASSISTANT_ENABLED = 'false';
    const draft = await createCompleteDraft(world);
    const res = await submit(draft);
    expect(res.body.release_state).toBe('held');
    expect(res.body.release_reasons).toEqual([
      expect.objectContaining({ code: 'assistant_disabled' }),
    ]);
  });
});

describe('visibility of the release state', () => {
  test('list, detail and export all carry release_state and reasons', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);

    const list = await as(world, 'supA').get('/api/handovers?status=submitted');
    expect(list.body.find((r) => r.record_id === draft.record_id).release_state).toBe('held');

    const exported = await as(world, 'supA').get(`/api/handovers/${draft.record_id}/export`);
    expect(exported.body.record.release_state).toBe('held');
    expect(exported.body.record.release_reasons.length).toBeGreaterThan(0);
  });

  test('held reports come first in the attention ranking', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);
    const res = await as(world, 'supA').get('/api/assistant/attention');
    expect(res.status).toBe(200);
    expect(res.body.items[0].record_id).toBe(draft.record_id);
    expect(res.body.items[0].release_state).toBe('held');
  });

  test('the digest counts auto-released and held reports', async () => {
    const draft = await createHeldDraft(world);
    await submit(draft);
    const res = await as(world, 'supA').get(`/api/assistant/digest?shift_id=${world.shifts.dept_a.current.shift_id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.counts.held).toBe(1);
    expect(res.body.data.counts.auto_released).toBe(0);
    expect(res.body.lines.join(' ')).toMatch(/held for approval/);
  });
});

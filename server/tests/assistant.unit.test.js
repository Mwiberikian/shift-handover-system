// Handover assistant (Part S): the pure functions, no database.
const { tokenize, buildIdf, vectorize, cosine } = require('../src/modules/assistant/text');
const { checkHandover } = require('../src/modules/assistant/quality');
const { findRecurring, clusterRecurring } = require('../src/modules/assistant/recurring');
const severity = require('../src/modules/assistant/severity');
const { scoreRecord, WEIGHTS } = require('../src/modules/assistant/ranking');
const { suggestTasks } = require('../src/modules/assistant/suggest');
const { rankDocuments } = require('../src/modules/assistant/search');
const { buildDigest } = require('../src/modules/assistant/digest');
const { QUALITY, SEVERITY, RECURRING } = require('../src/modules/assistant/constants');

describe('text', () => {
  test('synonyms, abbreviations and endings fold together', () => {
    expect(tokenize('Hyd leaking on A/C')).toEqual(tokenize('hydraulic leaks on aircraft'));
    expect(tokenize('refuelling and refueling')).toEqual(['refuel', 'refuel']);
  });
  test('stop words and generic words are dropped, numbers kept', () => {
    expect(tokenize('Please check the stand 4 issue')).toEqual(['stand', '4']);
    expect(tokenize('')).toEqual([]);
    expect(tokenize(null)).toEqual([]);
  });
  test('cosine is 1 for the same text, 0 for unrelated text', () => {
    const docs = ['hydraulic leak stand 4', 'baggage belt jam gate 3'];
    const idf = buildIdf(docs);
    expect(cosine(vectorize(docs[0], idf), vectorize(docs[0], idf))).toBeCloseTo(1, 5);
    expect(cosine(vectorize(docs[0], idf), vectorize(docs[1], idf))).toBe(0);
    expect(cosine(new Map(), vectorize(docs[0], idf))).toBe(0);
  });
});

describe('quality check', () => {
  const codes = (r) => r.flags.map((f) => f.code);
  const good = {
    summary: 'Normal shift overall. Hydraulic leak at stand 4 handled and logged for the next team.',
    tasks: [{ description: 'Replace hydraulic seal on stand 4 aircraft', priority: 'high', status: 'open' }],
    incidents: [{ title: 'Hydraulic leak on stand 4', severity: 'high' }],
  };

  test('a complete handover raises nothing', () => {
    const r = checkHandover(good);
    expect(r.flags).toEqual([]);
    expect(r.ready).toBe(true);
  });
  test('a serious incident with no follow-up task is high', () => {
    const r = checkHandover({ ...good, tasks: [{ description: 'Order stationery for the operations office', priority: 'low', status: 'open' }] });
    expect(codes(r)).toContain('incident_no_action');
    expect(r.ready).toBe(false);
  });
  test('sharing only a place ("stand 4") is not a link', () => {
    const r = checkHandover({ ...good, tasks: [{ description: 'Brief the team on the stand 4 allocation change', priority: 'low', status: 'open' }] });
    expect(codes(r)).toContain('incident_no_action');
  });
  test('low and medium incidents need no follow-up task', () => {
    const r = checkHandover({ ...good, incidents: [{ title: 'Scuffed paint on tractor', severity: 'low' }, { title: 'Slow belt', severity: 'medium' }] });
    expect(codes(r)).not.toContain('incident_no_action');
  });
  test('summary length boundary', () => {
    const at = (n) => checkHandover({ summary: 'x'.repeat(n), tasks: [], incidents: [] });
    expect(codes(at(QUALITY.minSummaryChars - 1))).toContain('summary_short');
    expect(codes(at(QUALITY.minSummaryChars))).not.toContain('summary_short');
  });
  test('"nothing to report" with incidents contradicts them; without incidents it is only a nudge', () => {
    expect(codes(checkHandover({ ...good, summary: 'Nothing to report' }))).toContain('summary_contradicts_incidents');
    const none = checkHandover({ summary: 'All ok', tasks: [], incidents: [] });
    expect(codes(none)).toEqual(['summary_filler']);
    expect(none.ready).toBe(true);
  });
  test('an empty summary is high', () => {
    expect(codes(checkHandover({ summary: '  ', tasks: [], incidents: [] }))).toEqual(['summary_missing']);
  });
  test('summary that leaves out a serious incident', () => {
    const r = checkHandover({ ...good, summary: 'Normal shift overall, all departures handled and the next team briefed.' });
    expect(codes(r)).toContain('summary_omits_incident');
  });
  test('critical incident without a high-priority open task', () => {
    const r = checkHandover({ ...good, incidents: [{ title: 'Hydraulic leak on stand 4', severity: 'critical' }], tasks: [{ description: 'Replace hydraulic seal on stand 4 aircraft', priority: 'medium', status: 'open' }] });
    expect(codes(r)).toContain('critical_without_high_task');
    const resolved = checkHandover({ ...good, incidents: [{ title: 'Hydraulic leak on stand 4', severity: 'critical' }], tasks: [{ description: 'Replace hydraulic seal on stand 4 aircraft', priority: 'high', status: 'resolved' }] });
    expect(codes(resolved)).toContain('critical_without_high_task');
  });
  test('vague task boundary: two content words flagged, three not', () => {
    expect(codes(checkHandover({ ...good, tasks: [...good.tasks, { description: 'check gpu', priority: 'low' }] }))).toContain('task_vague');
    expect(codes(checkHandover({ ...good, tasks: [...good.tasks, { description: 'inspect gpu cable stand', priority: 'low' }] }))).not.toContain('task_vague');
  });
  test('duplicate tasks', () => {
    const t = { description: 'Collect spare radio batteries from stores', priority: 'low' };
    expect(codes(checkHandover({ ...good, tasks: [...good.tasks, t, { ...t }] }))).toContain('duplicate_task');
  });
  test('stale carry boundary', () => {
    const stale = (d) => checkHandover({ ...good, staleTasks: [{ description: 'Chase the spare part order', carry_depth: d }] });
    expect(codes(stale(QUALITY.staleCarryDepth - 1))).not.toContain('stale_carry');
    expect(codes(stale(QUALITY.staleCarryDepth))).toContain('stale_carry');
  });
  test('missing inputs do not throw', () => {
    expect(() => checkHandover()).not.toThrow();
  });
});

describe('recurring issues', () => {
  const hist = [
    { id: 'a', kind: 'task', record_id: 'r1', text: 'Hydraulic leak on stand 4, seal replacement needed', shift_start: '2031-01-01' },
    { id: 'b', kind: 'task', record_id: 'r2', text: 'hyd leaking at stand 4 inspect seals', shift_start: '2031-01-02' },
    { id: 'c', kind: 'task', record_id: 'r3', text: 'Baggage belt jammed at gate 3', shift_start: '2031-01-03' },
  ];
  test('a similar item is found with its earlier occurrences', () => {
    const r = findRecurring([{ id: 'n', kind: 'task', text: 'Hydraulic leak at stand 4 aircraft again' }], hist);
    expect(r).toHaveLength(1);
    expect(r[0].occurrences).toBe(3);
    expect(r[0].matches.map((m) => m.record_id).sort()).toEqual(['r1', 'r2']);
  });
  test('an unrelated item is not', () => {
    expect(findRecurring([{ id: 'n', kind: 'task', text: 'Printer in the operations office out of toner' }], hist)).toEqual([]);
  });
  test('texts too short to compare are ignored', () => {
    expect(findRecurring([{ id: 'n', kind: 'task', text: 'gpu' }], [{ id: 'x', kind: 'task', record_id: 'r', text: 'gpu', shift_start: '2031-01-01' }])).toEqual([]);
  });
  test('one match per earlier record, however many items it has', () => {
    const twice = [...hist, { id: 'd', kind: 'incident', record_id: 'r1', text: 'Hydraulic leak stand 4 again', shift_start: '2031-01-01' }];
    const r = findRecurring([{ id: 'n', kind: 'task', text: 'Hydraulic leak at stand 4' }], twice);
    expect(r[0].matches.filter((m) => m.record_id === 'r1')).toHaveLength(1);
  });
  test('clusters need items from enough different handovers', () => {
    expect(clusterRecurring(hist)).toEqual([]); // hydraulic appears in 2 records, minimum is 3
    const three = [...hist, { id: 'e', kind: 'task', record_id: 'r4', text: 'Hydraulic leak by stand 4 aircraft again', shift_start: '2031-01-04' }];
    const c = clusterRecurring(three);
    expect(c).toHaveLength(1);
    expect(c[0].occurrences).toBe(RECURRING.clusterMinRecords);
    expect(c[0].first_seen < c[0].last_seen).toBe(true);
  });
  test('items of one record never form a cluster on their own', () => {
    const one = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}`, kind: 'task', record_id: 'same', text: 'Hydraulic leak on stand 4 seal', shift_start: '2031-01-01' }));
    expect(clusterRecurring(one)).toEqual([]);
  });
});

describe('severity suggestion', () => {
  const make = (n) => Array.from({ length: n }, (_, i) => (i % 2
    ? { text: `Fire and smoke near stand ${i}`, severity: 'critical' }
    : { text: `Minor cosmetic scuff on tractor ${i}`, severity: 'low' }));
  test('withheld until there is enough history', () => {
    const s = severity.suggest(make(SEVERITY.minTrainingExamples - 1), 'Fire near stand 3');
    expect(s.available).toBe(false);
    expect(s.reason).toMatch(/at least 30/);
  });
  test('available at the minimum, with a sensible answer and its basis', () => {
    const s = severity.suggest(make(SEVERITY.minTrainingExamples), 'Smoke and fire at the stand');
    expect(s.available).toBe(true);
    expect(s.severity).toBe('critical');
    expect(s.confidence).toBeGreaterThan(0.5);
    expect(s.top_terms.length).toBeGreaterThan(0);
  });
  test('needs two severities to have been used', () => {
    const one = Array.from({ length: 40 }, (_, i) => ({ text: `Minor scuff ${i}`, severity: 'low' }));
    expect(severity.suggest(one, 'Minor scuff').available).toBe(false);
  });
  test('words it has never seen give no suggestion', () => {
    const s = severity.suggest(make(40), 'Zzyzx qwerty');
    expect(s.available).toBe(false);
  });
  test('cross-validation is repeatable and reports the baseline', () => {
    const a = severity.crossValidate(make(60), 5); const b = severity.crossValidate(make(60), 5);
    expect(a).toEqual(b);
    expect(a.accuracy).toBeGreaterThan(0.9);
    expect(a.majority_baseline).toBeLessThanOrEqual(0.6);
  });
});

describe('attention ranking', () => {
  test('no risk scores zero', () => {
    expect(scoreRecord({ status: 'acknowledged', incidents: [], open_tasks: [], quality_counts: {} })).toEqual({ score: 0, level: 'low', reasons: [] });
  });
  test('a critical incident alone is medium; with a long wait and a high-priority task it is high', () => {
    const base = { status: 'submitted', incidents: [{ severity: 'critical' }], open_tasks: [], quality_counts: {} };
    expect(scoreRecord({ ...base, hours_since_submit: 0 }).level).toBe('medium');
    expect(scoreRecord({ ...base, hours_since_submit: 6 }).score).toBe(55); // 30 + the 25-point cap for waiting
    expect(scoreRecord({ ...base, hours_since_submit: 6, open_tasks: [{ priority: 'high' }] }).level).toBe('high');
  });
  test('each factor is capped and the total never passes 100', () => {
    const r = scoreRecord({
      status: 'queried', hours_since_submit: 100, incidents: Array(10).fill({ severity: 'critical' }),
      open_tasks: Array(10).fill({ priority: 'high', carry_depth: 9 }), quality_counts: { high: 9, medium: 9 },
    });
    expect(r.score).toBe(100);
    const inc = r.reasons.find((x) => x.code === 'incidents');
    expect(inc.points).toBe(WEIGHTS.incidentCap);
  });
  test('reasons are listed largest first', () => {
    const r = scoreRecord({ status: 'submitted', hours_since_submit: 3, incidents: [{ severity: 'high' }], open_tasks: [{ priority: 'high' }], quality_counts: {} });
    const pts = r.reasons.map((x) => x.points);
    expect(pts).toEqual([...pts].sort((a, b) => b - a));
  });
  test('closed-type statuses add nothing for waiting', () => {
    expect(scoreRecord({ status: 'acknowledged', hours_since_submit: 50, incidents: [], open_tasks: [] }).reasons).toEqual([]);
  });
});

describe('suggested tasks', () => {
  const rows = [];
  for (let i = 0; i < 5; i += 1) rows.push({ record_id: `r${i}`, description: i % 2 ? 'Check GPU on stand 5 before first departure' : 'GPU on stand 5 check before the first departure', priority: 'high', shift_start: `2031-01-0${i + 1}` });
  rows.push({ record_id: 'r0', description: 'Collect radio batteries from stores', priority: 'low', shift_start: '2031-01-01' });
  test('a task seen in at least three handovers is suggested', () => {
    const s = suggestTasks([], rows);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ priority: 'high', support: 5 });
  });
  test('not when it is already in the draft', () => {
    expect(suggestTasks([{ description: 'Check GPU on stand 5 before first departure' }], rows)).toEqual([]);
  });
  test('not when it appeared fewer than three times, or history is short', () => {
    expect(suggestTasks([], rows.slice(0, 2))).toEqual([]);
  });
});

describe('search by meaning', () => {
  const docs = [
    { record_id: 'a', parts: [{ kind: 'task', text: 'Hydraulic leak on stand 4, seal needed' }] },
    { record_id: 'b', parts: [{ kind: 'task', text: 'Baggage belt jam at gate 3' }, { kind: 'summary', text: 'Quiet night' }] },
  ];
  test('finds by meaning, not only by the exact words', () => {
    const r = rankDocuments('hyd leaking', docs);
    expect(r.map((x) => x.record_id)).toEqual(['a']);
    expect(r[0].snippet.kind).toBe('task');
  });
  test('an exact phrase scores higher than the same words apart', () => {
    const d = [{ record_id: 'x', parts: [{ kind: 'task', text: 'seal on the stand, leak elsewhere' }] }, { record_id: 'y', parts: [{ kind: 'task', text: 'leak on stand' }] }];
    expect(rankDocuments('leak on stand', d)[0].record_id).toBe('y');
  });
  test('nothing for empty or unmatched queries', () => {
    expect(rankDocuments('the and', docs)).toEqual([]);
    expect(rankDocuments('zzzz', docs)).toEqual([]);
  });
});

describe('digest', () => {
  const base = {
    department_name: 'Ground Operations', shift_type: 'night', shift_end: '2031-03-10T15:00:00Z',
    counts: { submitted: 2, acknowledged: 1, unacknowledged: 1, closed: 0, escalated: 0, no_handover: false },
    incidents: { critical: 1, high: 0, medium: 0, low: 2 }, open_high_tasks: 3, stale_tasks: 1,
    attention: [{ level: 'high', score: 70, reasons: [{ text: '1 high or critical incident' }, { text: 'not acknowledged after 3 h' }] }],
    recurring: [{ label: 'Hydraulic leak on stand 4', occurrences: 4 }],
  };
  test('plain sentences with the numbers', () => {
    const d = buildDigest(base);
    expect(d.title).toBe('Ground Operations: night shift digest (ended 10 Mar, 18:00 EAT)');
    expect(d.lines).toEqual(expect.arrayContaining([
      '2 handovers submitted: 1 acknowledged, 1 waiting for acknowledgement, 0 closed.',
      '1 critical incident and 0 high-severity incidents reported.',
      '3 open high-priority tasks to follow up.',
    ]));
    expect(d.headline).toBe('Ground Operations night shift: 2 handovers, 1 unacknowledged, 1 serious incident.');
  });
  test('says so when nothing was submitted', () => {
    const d = buildDigest({ ...base, counts: { no_handover: true }, incidents: {}, attention: [], recurring: [] });
    expect(d.lines[0]).toBe('No handover was submitted for this shift.');
    expect(d.headline).toMatch(/no handover/i);
  });
});

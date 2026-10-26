// Runs the assistant against the synthetic data and returns the measurements.
// Used by scripts/assistant-eval.js (prints them) and tests/assistant.eval.test.js
// (checks them against the criteria written down in ../constants.js).
const syn = require('./synthetic');
const { checkHandover } = require('../quality');
const { findRecurring } = require('../recurring');
const severity = require('../severity');
const { rankDocuments } = require('../search');
const { suggestTasks } = require('../suggest');
const { tokenize } = require('../text');

const ratio = (a, b) => (b ? a / b : null);
const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);

function quality(seed) {
  const CODES = ['incident_no_action', 'summary_omits_incident', 'summary_contradicts_incidents', 'summary_short', 'task_vague', 'duplicate_task'];
  const cases = syn.qualityCases(seed);
  const per = {}; CODES.forEach((c) => { per[c] = { tp: 0, fp: 0, fn: 0 }; });
  cases.forEach((c) => {
    const got = new Set(checkHandover({ summary: c.summary, tasks: c.tasks, incidents: c.incidents }).flags.map((f) => f.code));
    CODES.forEach((code) => {
      const want = c.planted.includes(code); const has = got.has(code);
      if (want && has) per[code].tp += 1; else if (!want && has) per[code].fp += 1; else if (want && !has) per[code].fn += 1;
    });
  });
  const sum = (k) => CODES.reduce((s, c) => s + per[c][k], 0);
  const perCode = {};
  CODES.forEach((c) => { perCode[c] = { ...per[c], precision: round(ratio(per[c].tp, per[c].tp + per[c].fp)), recall: round(ratio(per[c].tp, per[c].tp + per[c].fn)) }; });
  return {
    cases: cases.length, planted: sum('tp') + sum('fn'), precision: round(ratio(sum('tp'), sum('tp') + sum('fp'))), recall: round(ratio(sum('tp'), sum('tp') + sum('fn'))), per_code: perCode,
  };
}

function recurring(seed) {
  const hist = syn.history(seed);
  const rows = hist.flatMap((r) => r.items.map((it, i) => ({
    id: `${r.record_id}-${i}`, kind: 'task', record_id: r.record_id, text: it.text, shift_start: r.shift_start,
  })));
  const drafts = syn.drafts(seed + 10, hist);
  const found = new Set(findRecurring(drafts.map((d) => ({ id: d.id, kind: 'task', text: d.text })), rows).map((f) => f.id));
  const exact = new Set(drafts.filter((d) => rows.some((h) => h.text === d.text)).map((d) => d.id));
  const score = (set) => {
    let tp = 0; let fp = 0; let fn = 0;
    drafts.forEach((d) => {
      const has = set.has(d.id);
      if (d.truth_recurring && has) tp += 1; else if (!d.truth_recurring && has) fp += 1; else if (d.truth_recurring && !has) fn += 1;
    });
    return { tp, fp, fn, precision: round(ratio(tp, tp + fp)), recall: round(ratio(tp, tp + fn)) };
  };
  return { items: drafts.length, truth_recurring: drafts.filter((d) => d.truth_recurring).length, assistant: score(found), baseline_exact_text: score(exact) };
}

function sev(seed) {
  const c = syn.severityCorpus(seed);
  const model = severity.train(c.train);
  const majority = (() => { const n = {}; c.train.forEach((e) => { n[e.severity] = (n[e.severity] || 0) + 1; }); return Object.keys(n).sort((a, b) => n[b] - n[a])[0]; })();
  const rank = (s) => severity.LEVELS.indexOf(s);
  const evalSet = (set) => {
    let right = 0; let within = 0; let majorityRight = 0; let answered = 0; let answeredRight = 0;
    set.forEach((e) => {
      const p = severity.predict(model, e.text);
      if (p.severity === e.severity) right += 1;
      if (Math.abs(rank(p.severity) - rank(e.severity)) <= 1) within += 1;
      if (majority === e.severity) majorityRight += 1;
      const s = severity.suggest(c.train, e.text);
      if (s.available) { answered += 1; if (s.severity === e.severity) answeredRight += 1; }
    });
    return {
      n: set.length, accuracy: round(right / set.length), within_one: round(within / set.length), majority_baseline: round(majorityRight / set.length), answered: round(answered / set.length), accuracy_when_answered: round(ratio(answeredRight, answered)),
    };
  };
  return { train_n: c.train.length, majority_class: majority, seen_phrasing: evalSet(c.seen), unseen_phrasing: evalSet(c.unseen) };
}

function search(seed) {
  const hist = syn.history(seed);
  const docs = hist.map((r) => ({ record_id: r.record_id, parts: r.items.map((i) => ({ kind: 'task', text: i.text })) }));
  let n = 0; let hitA = 0; let hitB = 0; let mrr = 0;
  syn.FAMILIES.forEach((f) => {
    const relevant = new Set(hist.filter((r) => r.items.some((i) => i.family === f.id)).map((r) => r.record_id));
    if (!relevant.size) return;
    f.queries.forEach((q) => {
      n += 1;
      const ranked = rankDocuments(q, docs, { limit: 20 }).map((d) => d.record_id);
      if (ranked.slice(0, 5).some((id) => relevant.has(id))) hitA += 1;
      const idx = ranked.findIndex((id) => relevant.has(id)); if (idx >= 0) mrr += 1 / (idx + 1);
      const kw = docs.filter((d) => d.parts.some((p) => p.text.toLowerCase().includes(q.toLowerCase()))).map((d) => d.record_id);
      if (kw.slice(0, 5).some((id) => relevant.has(id))) hitB += 1;
    });
  });
  return { queries: n, assistant_hit_at_5: round(hitA / n), assistant_mrr: round(mrr / n), baseline_keyword_hit_at_5: round(hitB / n) };
}

function suggest(seed) {
  const hist = syn.ownHistory(seed);
  const rows = hist.flatMap((r) => r.items.map((it) => ({
    record_id: r.record_id, description: it.text, priority: 'medium', shift_start: r.shift_start,
  })));
  const counts = {};
  hist.forEach((r) => new Set(r.items.map((i) => i.family).filter(Boolean)).forEach((f) => { counts[f] = (counts[f] || 0) + 1; }));
  const truth = new Set(Object.keys(counts).filter((f) => counts[f] >= 3));
  const got = suggestTasks([], rows);
  const fam = (text) => syn.FAMILIES.find((f) => f.texts.some((t) => tokenize(t).join(' ') === tokenize(text).join(' ')))?.id;
  const gotFam = new Set(got.map((g) => fam(g.text)).filter(Boolean));
  let tp = 0; gotFam.forEach((f) => { if (truth.has(f)) tp += 1; });
  return {
    truth: truth.size, suggested: got.length, precision: round(ratio(tp, got.length)), recall: round(ratio(tp, truth.size)),
  };
}

function runEvaluation(seed = 1) {
  return {
    seed, quality: quality(seed + 40), recurring: recurring(seed + 20), severity: sev(seed + 10), search: search(seed + 20), suggest: suggest(seed + 20),
  };
}

module.exports = { runEvaluation };

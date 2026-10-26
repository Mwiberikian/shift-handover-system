// Severity suggestion. A multinomial Naive Bayes classifier (Laplace
// smoothing) trained, on request, on the department's own past incidents:
// the label is the severity a person chose, so the suggestion reflects how
// this department grades incidents. It only suggests. The author picks, and
// whether the suggestion was taken or overridden is logged.
//
//   train(examples)                 -> model | null     examples: [{ text, severity }]
//   predict(model, text)            -> { severity, confidence, probabilities, top_terms }
//   suggest(examples, text)         -> { available, ... }   the service entry point
//   crossValidate(examples, k)      -> accuracy, within-one, per-class precision and recall
const { tokenize } = require('./text');
const { SEVERITY } = require('./constants');

const LEVELS = ['low', 'medium', 'high', 'critical'];
const rank = (s) => LEVELS.indexOf(s);

function train(examples) {
  const clean = examples.filter((e) => LEVELS.includes(e.severity)).map((e) => ({ tokens: tokenize(e.text), severity: e.severity })).filter((e) => e.tokens.length);
  if (clean.length < SEVERITY.minTrainingExamples) return null;
  const classCount = {}; const termCount = {}; const totalTerms = {}; const vocab = new Set();
  LEVELS.forEach((l) => { classCount[l] = 0; termCount[l] = new Map(); totalTerms[l] = 0; });
  clean.forEach((e) => {
    classCount[e.severity] += 1;
    e.tokens.forEach((t) => {
      termCount[e.severity].set(t, (termCount[e.severity].get(t) || 0) + 1);
      totalTerms[e.severity] += 1;
      vocab.add(t);
    });
  });
  const usable = LEVELS.filter((l) => classCount[l] >= SEVERITY.minPerClassForTraining);
  if (usable.length < SEVERITY.minClasses) return null;
  return {
    levels: usable, classCount, termCount, totalTerms, vocab, n: clean.length,
  };
}

function logScores(model, tokens) {
  const V = model.vocab.size;
  const scores = {};
  model.levels.forEach((l) => {
    let s = Math.log(model.classCount[l] / model.n);
    tokens.forEach((t) => {
      if (!model.vocab.has(t)) return; // unseen terms carry no evidence
      s += Math.log(((model.termCount[l].get(t) || 0) + 1) / (model.totalTerms[l] + V));
    });
    scores[l] = s;
  });
  return scores;
}

function predict(model, text) {
  const tokens = tokenize(text);
  const known = tokens.filter((t) => model.vocab.has(t));
  const scores = logScores(model, tokens);
  const max = Math.max(...Object.values(scores));
  const exp = {}; let sum = 0;
  Object.entries(scores).forEach(([l, s]) => { exp[l] = Math.exp(s - max); sum += exp[l]; });
  const probabilities = {};
  Object.keys(exp).forEach((l) => { probabilities[l] = Math.round((exp[l] / sum) * 1000) / 1000; });
  const severity = Object.keys(probabilities).sort((a, b) => probabilities[b] - probabilities[a])[0];
  // The words that pushed hardest towards the answer, for the explanation.
  const V = model.vocab.size;
  const others = model.levels.filter((l) => l !== severity);
  const top = [...new Set(known)].map((t) => {
    const p = ((model.termCount[severity].get(t) || 0) + 1) / (model.totalTerms[severity] + V);
    const q = others.length ? others.reduce((s, l) => s + ((model.termCount[l].get(t) || 0) + 1) / (model.totalTerms[l] + V), 0) / others.length : p;
    return { term: t, lift: Math.log(p / q) };
  }).filter((x) => x.lift > 0).sort((a, b) => b.lift - a.lift).slice(0, 3).map((x) => x.term);
  return {
    severity, confidence: probabilities[severity], probabilities, top_terms: top, known_terms: known.length,
  };
}

function suggest(examples, text) {
  const model = train(examples);
  if (!model) return { available: false, reason: `Needs at least ${SEVERITY.minTrainingExamples} past incidents with at least ${SEVERITY.minClasses} severities used.`, trained_on: examples.length };
  const p = predict(model, text);
  if (!p.known_terms) return { available: false, reason: 'None of the words are in this department’s history yet.', trained_on: model.n };
  if (p.confidence < SEVERITY.minConfidence) return { available: false, reason: 'Not confident enough to suggest a severity.', trained_on: model.n, confidence: p.confidence };
  return { available: true, trained_on: model.n, ...p };
}

// k-fold cross-validation with a fixed fold assignment (no randomness).
function crossValidate(examples, k = 5) {
  const data = examples.filter((e) => LEVELS.includes(e.severity));
  const folds = Array.from({ length: k }, () => []);
  data.forEach((e, i) => folds[i % k].push(e));
  let n = 0; let right = 0; let within = 0; let skipped = 0;
  const per = {}; LEVELS.forEach((l) => { per[l] = { tp: 0, fp: 0, fn: 0 }; });
  const counts = {}; data.forEach((e) => { counts[e.severity] = (counts[e.severity] || 0) + 1; });
  const majority = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  let majorityRight = 0;
  for (let f = 0; f < k; f += 1) {
    const model = train(data.filter((_, i) => i % k !== f));
    folds[f].forEach((e) => {
      if (!model) { skipped += 1; return; }
      const p = predict(model, e.text);
      n += 1;
      if (p.severity === e.severity) { right += 1; per[e.severity].tp += 1; } else { per[e.severity].fn += 1; per[p.severity].fp += 1; }
      if (Math.abs(rank(p.severity) - rank(e.severity)) <= 1) within += 1;
      if (e.severity === majority) majorityRight += 1;
    });
  }
  const perClass = {};
  LEVELS.forEach((l) => {
    const { tp, fp, fn } = per[l];
    perClass[l] = { precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, support: counts[l] || 0 };
  });
  return {
    n, skipped, accuracy: n ? right / n : null, within_one: n ? within / n : null, majority_class: majority, majority_baseline: n ? majorityRight / n : null, per_class: perClass,
  };
}

module.exports = {
  train, predict, suggest, crossValidate, LEVELS,
};

// The assistant against the synthetic evaluation data, judged by the criteria
// written down before any evaluation was run (assistant/constants.js CRITERIA).
// A miss here is a result to report, not a threshold to lower.
const { runEvaluation } = require('../src/modules/assistant/eval/run');
const { CRITERIA } = require('../src/modules/assistant/constants');

const r = runEvaluation(1);

test('quality check finds the planted defects', () => {
  expect(r.quality.recall).toBeGreaterThanOrEqual(CRITERIA.quality.recall);
  expect(r.quality.precision).toBeGreaterThanOrEqual(CRITERIA.quality.precision);
});
test('recurring issues: precise and better than exact-text matching', () => {
  expect(r.recurring.assistant.precision).toBeGreaterThanOrEqual(CRITERIA.recurring.precision);
  expect(r.recurring.assistant.recall).toBeGreaterThanOrEqual(CRITERIA.recurring.recall);
  expect(r.recurring.assistant.recall).toBeGreaterThan(r.recurring.baseline_exact_text.recall);
});
test('severity beats the majority class on phrasing it never saw', () => {
  const u = r.severity.unseen_phrasing;
  expect(u.accuracy - u.majority_baseline).toBeGreaterThanOrEqual(CRITERIA.severity.minAccuracyOverMajority);
  expect(u.within_one).toBeGreaterThanOrEqual(CRITERIA.severity.minWithinOne);
});
test('search by meaning beats keyword search', () => {
  expect(r.search.assistant_hit_at_5).toBeGreaterThanOrEqual(CRITERIA.search.minHitAt5);
  expect(r.search.assistant_hit_at_5).toBeGreaterThan(r.search.baseline_keyword_hit_at_5);
});
test('the evaluation is repeatable', () => {
  expect(runEvaluation(1)).toEqual(r);
});

// Phase 2 hazard evaluation, judged by the criteria written down in
// assistant/constants.js CRITERIA.release before the evaluation was first
// run. Recall of holds dominates: missing a real hazard is the dangerous
// error. Misses are listed in the output (missed_hazards), not hidden.
const { runEvaluation } = require('../src/modules/assistant/eval/run');
const { CRITERIA } = require('../src/modules/assistant/constants');

const r = runEvaluation(1).release;

test('the hazard set is big enough to mean something', () => {
  expect(r.cases).toBeGreaterThanOrEqual(200);
  expect(r.truth_holds).toBeGreaterThanOrEqual(50);
  expect(r.cases - r.truth_holds).toBeGreaterThanOrEqual(50);
});

test('recall of holds meets the pre-registered criterion (false releases are the dangerous error)', () => {
  expect(r.recall).toBeGreaterThanOrEqual(CRITERIA.release.recall);
});

test('precision of holds meets the pre-registered criterion (false holds stay bearable)', () => {
  expect(r.precision).toBeGreaterThanOrEqual(CRITERIA.release.precision);
});

test('misses are reported by name, not just counted', () => {
  // The output must carry the lists even when they are empty, so a regression
  // shows the exact phrasings that slipped through.
  expect(Array.isArray(r.missed_hazards)).toBe(true);
  expect(Array.isArray(r.false_holds)).toBe(true);
  if (r.fn === 0) expect(r.missed_hazards).toEqual([]);
  else expect(r.missed_hazards.length).toBeGreaterThan(0);
});

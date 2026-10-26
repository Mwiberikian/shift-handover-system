#!/usr/bin/env node
// Runs the handover assistant against the synthetic evaluation data and prints
// the measurements next to the criteria that were written down beforehand
// (src/modules/assistant/constants.js). Fixed seed, so the numbers repeat.
//   npm run assistant:eval [-- --seed 1 --out result.json]
const fs = require('fs');
const { runEvaluation } = require('../src/modules/assistant/eval/run');
const { CRITERIA } = require('../src/modules/assistant/constants');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const seed = Number(opt('--seed', 1));
const r = runEvaluation(seed);

const verdict = (ok) => (ok ? 'MET' : 'NOT MET');
const sev = r.severity.unseen_phrasing;
const lines = [`Seed ${seed}. All data synthetic; labels come from the generator (see eval/synthetic.js).`, ''];
lines.push(`Quality check    ${r.quality.cases} cases, ${r.quality.planted} planted defects: precision ${r.quality.precision}, recall ${r.quality.recall}  [precision >= ${CRITERIA.quality.precision}, recall >= ${CRITERIA.quality.recall}: ${verdict(r.quality.precision >= CRITERIA.quality.precision && r.quality.recall >= CRITERIA.quality.recall)}]`);
lines.push(`Recurring issues ${r.recurring.items} draft items (${r.recurring.truth_recurring} truly recurring): precision ${r.recurring.assistant.precision}, recall ${r.recurring.assistant.recall}; exact-text baseline precision ${r.recurring.baseline_exact_text.precision}, recall ${r.recurring.baseline_exact_text.recall}  [precision >= ${CRITERIA.recurring.precision}, recall >= ${CRITERIA.recurring.recall}: ${verdict(r.recurring.assistant.precision >= CRITERIA.recurring.precision && r.recurring.assistant.recall >= CRITERIA.recurring.recall)}]`);
lines.push(`Severity         trained on ${r.severity.train_n}; seen phrasing accuracy ${r.severity.seen_phrasing.accuracy}; UNSEEN phrasing n=${sev.n}: accuracy ${sev.accuracy} (majority baseline ${sev.majority_baseline}), within one level ${sev.within_one}; answered ${sev.answered}, accuracy when answered ${sev.accuracy_when_answered}  [accuracy over majority >= ${CRITERIA.severity.minAccuracyOverMajority}, within one >= ${CRITERIA.severity.minWithinOne}: ${verdict(sev.accuracy - sev.majority_baseline >= CRITERIA.severity.minAccuracyOverMajority && sev.within_one >= CRITERIA.severity.minWithinOne)}]`);
lines.push(`Search           ${r.search.queries} queries: hit@5 ${r.search.assistant_hit_at_5}, MRR ${r.search.assistant_mrr}; keyword baseline hit@5 ${r.search.baseline_keyword_hit_at_5}  [hit@5 >= ${CRITERIA.search.minHitAt5}: ${verdict(r.search.assistant_hit_at_5 >= CRITERIA.search.minHitAt5)}]`);
lines.push(`Suggested tasks  ${r.suggest.truth} habitual tasks, ${r.suggest.suggested} suggested: precision ${r.suggest.precision}, recall ${r.suggest.recall}  (no pre-registered criterion)`);
console.log(lines.join('\n'));
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(r, null, 2));

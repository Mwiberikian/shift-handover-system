# Shift Handover Assistant (Part S)

Seven advisory functions added in response to the lecturer's feedback that SHMS lacked automation or intelligence. Every function is **advisory**: nothing blocks a submission, and nothing changes a record unless a person clicks. Switch the lot off with `ASSISTANT_ENABLED=false` (the routes answer 404, the client hides the panels, and the digest reminder is skipped).

All of it runs inside the Node server in plain JavaScript. No data leaves the system and no external AI service is called.

| # | Function | Who sees it | Method |
|---|----------|-------------|--------|
| 1 | Handover quality check | Outgoing author, on a draft | Ten explainable rules (empty or filler summary, summary contradicting incidents, incident with no follow-up task, critical incident with no high-priority task, vague or duplicate task, task carried over 3+ shifts) |
| 2 | Recurring issues | Author (on a draft); supervisors (department view) | TF-IDF cosine similarity with a light stemmer and an aviation synonym table; single-link clustering |
| 3 | Attention ranking | Supervisors, admins | Additive score 0 to 100 where every point has a stated reason |
| 4 | Search by meaning | Supervisors, admins | TF-IDF cosine, exact-phrase boost, snippet of the best part |
| 5 | Suggested tasks | Author | Tasks seen in at least 3 of the author's department's last 10 handovers for that shift type and not in the draft; accept or dismiss |
| 6 | Severity hint | Author, on the incident form | Multinomial Naive Bayes trained on the department's own incidents (Laplace smoothing); withheld below 50% confidence or with under 30 past incidents |
| 7 | Shift digest | Supervisors (screen and a `shift_digest` notification 15 min after shift end) | Template filled from counts, ranking and clusters |

## Privacy and access

* Same role rules as the rest of the system (`requireRole`, `assertDepartmentAccess`). Outgoing staff reach only their own drafts; supervisors only their department; admins any.
* Text from other authors' handovers is not shown to outgoing staff (FR-03): a recurring match from someone else's record returns `text: null, hidden: true`.
* Models are per department. Severity is trained on that department's incidents only.
* `assistant_event` logs what a user did with a suggestion (shown, accepted, dismissed). It is append-only (database trigger), holds a payload of at most 1 KB, and stores no handover text.

## Pre-registered acceptance criteria

Written into `server/src/modules/assistant/constants.js` (`CRITERIA`) before any evaluation was run and not changed afterwards.

| Function | Criterion |
|----------|-----------|
| Quality | recall >= 0.90, precision >= 0.80 |
| Recurring | recall >= 0.70, precision >= 0.90 |
| Severity | accuracy at least 0.10 above the majority-class baseline; within one level >= 0.85 |
| Search | hit@5 >= 0.80 |

Run `npm run assistant:eval` in `server/` (`--seed N`, `--out file.json`).

## Results (seed 1, synthetic data)

| Function | Result |
|----------|--------|
| Quality | precision 1.00, recall 1.00 on 200 cases |
| Recurring | precision 1.00, recall 0.83 (exact-text baseline recall 0.54) |
| Severity | unseen phrasing: accuracy 0.64 vs 0.25 majority, within one level 0.88; answered 81% of cases |
| Search | hit@5 1.00, MRR 0.97 (keyword baseline hit@5 0.33) |
| Suggested tasks | precision 1.00, recall 0.50 (no criterion set) |

## Limits, stated plainly

* **The data is synthetic and the labels come from the same generator that was written to exercise the rules.** The quality-check scores of 1.00 are therefore circular and show the rules do what they were written to do, not that they match what real supervisors would flag. The same author wrote the search queries and the synonym table.
* A first recurring run showed precision 0.77. That came from a generator bug (identical filler tasks counted as unplanted duplicates); the exact-text baseline had the same false positives. The generator was fixed, the thresholds were not changed.
* Severity on wording the model has not seen is 64% accurate and it declines about 19% of cases. Treat it as a hint.
* Recurring recall misses some paraphrases at the 0.5 threshold; suggested tasks miss groups that paraphrasing splits at 0.6.
* None of this has been tested on Kenya Airways data. A real evaluation needs real, consented handover history labelled by supervisors.

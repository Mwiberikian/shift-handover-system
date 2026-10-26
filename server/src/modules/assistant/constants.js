// Thresholds for the handover assistant (Part S). They were written down
// before any evaluation was run (see docs/ASSISTANT.md) and are not tuned to
// the results: a miss is reported as a miss.
module.exports = {
  QUALITY: {
    minSummaryChars: 40,
    minTaskTokens: 3,
    staleCarryDepth: 3, // a task carried over this many shifts in a row is flagged
    duplicateSimilarity: 0.8, // token Jaccard between two tasks of one handover
  },
  RECURRING: {
    similarity: 0.5, // cosine between two items for "the same issue"
    minTokens: 3, // shorter texts are too thin to match
    historyDays: 30,
    clusterMinRecords: 3, // a cluster needs this many different handovers
    maxItems: 600,
  },
  SUGGEST: {
    recordsConsidered: 10, // last N submitted handovers, same department and shift type
    minSupport: 3, // a task must appear in at least this many of them
    similarity: 0.6,
    maxSuggestions: 5,
  },
  SEVERITY: {
    minTrainingExamples: 30,
    minPerClassForTraining: 3,
    minClasses: 2,
    minConfidence: 0.5, // below this the suggestion is withheld
    trainingDays: 365,
  },
  SEARCH: {
    minScore: 0.12,
    limit: 20,
    corpusDays: 365,
    maxRecords: 1500,
  },
  RANKING: {
    high: 60,
    medium: 30,
    maxItems: 50,
  },
  // Pre-registered acceptance criteria for the synthetic evaluation
  // (server/scripts/assistant-eval.js, tests/assistant.eval.test.js).
  CRITERIA: {
    quality: { recall: 0.9, precision: 0.8 },
    recurring: { recall: 0.7, precision: 0.9 },
    severity: { minAccuracyOverMajority: 0.1, minWithinOne: 0.85 },
    search: { minHitAt5: 0.8 },
  },
  EVENT_KINDS: [
    'flags_shown', 'flag_dismissed', 'submitted_with_flags',
    'suggestion_shown', 'suggestion_accepted', 'suggestion_dismissed',
    'severity_suggested', 'severity_accepted', 'severity_overridden',
    'recurring_shown', 'search_run', 'digest_opened',
  ],
};

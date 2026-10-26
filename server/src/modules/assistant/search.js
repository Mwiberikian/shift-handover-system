// Search by meaning. Ranks past handovers against a question using TF-IDF
// cosine over content tokens, with the aviation synonym table (so "hyd leak"
// finds "hydraulic leaking") and a small boost when the exact words appear.
// The existing keyword search (FR-16) stays as it is; this is an addition.
//
//   rankDocuments(query, docs, { limit, minScore }) -> [{ record_id, score, snippet, ... }]
// docs: [{ record_id, parts: [{ kind, text }], ...anything else to pass through }]
const {
  tokenize, buildIdf, vectorize, cosine,
} = require('./text');
const { SEARCH } = require('./constants');

function rankDocuments(query, docs, { limit = SEARCH.limit, minScore = SEARCH.minScore } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length || !docs.length) return [];
  const partTokens = docs.map((d) => d.parts.map((p) => tokenize(p.text)));
  const docTokens = partTokens.map((ps) => ps.flat());
  const idf = buildIdf(docTokens);
  const qv = vectorize(qTokens, idf);
  const phrase = String(query).trim().toLowerCase();
  const scored = [];
  docs.forEach((d, i) => {
    const dv = vectorize(docTokens[i], idf);
    let score = cosine(qv, dv);
    if (score <= 0) return;
    const hasPhrase = phrase.length >= 4 && d.parts.some((p) => String(p.text).toLowerCase().includes(phrase));
    if (hasPhrase) score = Math.min(1, score + 0.2);
    if (score < minScore) return;
    // Best matching part for the snippet.
    let best = 0; let bestScore = -1;
    d.parts.forEach((p, k) => {
      const s = cosine(qv, vectorize(partTokens[i][k], idf));
      if (s > bestScore) { best = k; bestScore = s; }
    });
    const part = d.parts[best];
    scored.push({
      ...d, parts: undefined, score: Math.round(score * 100) / 100, snippet: { kind: part.kind, text: String(part.text).slice(0, 240) },
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { rankDocuments };

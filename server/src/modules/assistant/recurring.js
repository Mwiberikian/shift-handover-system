// Recurring-issue detection. An item (task or incident) is "recurring" when
// earlier handovers of the same department contain a similar one. Similarity
// is TF-IDF cosine over content tokens (text.js). Nothing leaves the server.
//
//   findRecurring(items, history)    for one draft: which items have been seen before
//   clusterRecurring(history)        for supervisors: issues that keep coming back
//
// history rows: { id, kind, record_id, text, shift_start, record_label? }
const {
  tokenize, buildIdf, vectorize, cosine,
} = require('./text');
const { RECURRING } = require('./constants');

function prepare(rows) {
  return rows
    .map((r) => ({ ...r, tokens: tokenize(r.text) }))
    .filter((r) => r.tokens.length >= RECURRING.minTokens);
}

function findRecurring(items, history, { similarity = RECURRING.similarity } = {}) {
  const hist = prepare(history).slice(0, RECURRING.maxItems);
  const cur = prepare(items);
  if (!hist.length || !cur.length) return [];
  const idf = buildIdf([...hist.map((h) => h.tokens), ...cur.map((c) => c.tokens)]);
  const hv = hist.map((h) => vectorize(h.tokens, idf));
  const out = [];
  cur.forEach((c) => {
    const cv = vectorize(c.tokens, idf);
    const byRecord = new Map();
    hv.forEach((v, i) => {
      const s = cosine(cv, v);
      if (s < similarity) return;
      const h = hist[i];
      const prev = byRecord.get(h.record_id);
      if (!prev || s > prev.similarity) {
        byRecord.set(h.record_id, {
          record_id: h.record_id, id: h.id, kind: h.kind, text: h.text, shift_start: h.shift_start, similarity: Math.round(s * 100) / 100,
        });
      }
    });
    if (byRecord.size) {
      const matches = [...byRecord.values()].sort((a, b) => b.similarity - a.similarity || new Date(b.shift_start) - new Date(a.shift_start));
      out.push({
        id: c.id, kind: c.kind, text: c.text, occurrences: matches.length + 1, matches: matches.slice(0, 5),
      });
    }
  });
  return out;
}

// Single-link clustering over items from different records.
function clusterRecurring(history, { similarity = RECURRING.similarity, minRecords = RECURRING.clusterMinRecords } = {}) {
  const rows = prepare(history).slice(0, RECURRING.maxItems);
  if (rows.length < minRecords) return [];
  const idf = buildIdf(rows.map((r) => r.tokens));
  const vecs = rows.map((r) => vectorize(r.tokens, idf));
  const parent = rows.map((_, i) => i);
  const find = (x) => { let r = x; while (parent[r] !== r) r = parent[r]; let c = x; while (parent[c] !== r) { const n = parent[c]; parent[c] = r; c = n; } return r; };
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[i].record_id !== rows[j].record_id && cosine(vecs[i], vecs[j]) >= similarity) {
        parent[find(i)] = find(j);
      }
    }
  }
  const groups = new Map();
  rows.forEach((r, i) => { const k = find(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); });
  const clusters = [];
  for (const idxs of groups.values()) {
    const recordIds = new Set(idxs.map((i) => rows[i].record_id));
    if (recordIds.size < minRecords) continue;
    // Representative: the member most similar to the others.
    let best = idxs[0]; let bestScore = -1;
    idxs.forEach((i) => {
      const score = idxs.reduce((s, j) => s + (i === j ? 0 : cosine(vecs[i], vecs[j])), 0);
      if (score > bestScore) { best = i; bestScore = score; }
    });
    const dates = idxs.map((i) => new Date(rows[i].shift_start).getTime());
    clusters.push({
      label: rows[best].text,
      occurrences: recordIds.size,
      kinds: [...new Set(idxs.map((i) => rows[i].kind))],
      first_seen: new Date(Math.min(...dates)).toISOString(),
      last_seen: new Date(Math.max(...dates)).toISOString(),
      record_ids: [...recordIds],
    });
  }
  return clusters.sort((a, b) => b.occurrences - a.occurrences || new Date(b.last_seen) - new Date(a.last_seen));
}

module.exports = { findRecurring, clusterRecurring };

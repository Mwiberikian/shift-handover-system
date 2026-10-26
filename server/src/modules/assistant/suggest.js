// Suggested tasks. Looks at the last few submitted handovers of the same
// department and shift type and proposes tasks that keep appearing (in at
// least SUGGEST.minSupport of them) and are not already in the draft. The user
// accepts or ignores each one; the choice is logged so the acceptance rate is
// measurable. Nothing is added automatically.
//
//   suggestTasks(draftTasks, history) -> [{ text, priority, support, of, last_seen }]
// history rows: { record_id, description, priority, shift_start }
const {
  tokenize, buildIdf, vectorize, cosine,
} = require('./text');
const { SUGGEST } = require('./constants');
const crypto = require('crypto');

const idFor = (text) => crypto.createHash('sha1').update(tokenize(text).sort().join(' ')).digest('hex').slice(0, 12);

function suggestTasks(draftTasks, history) {
  const records = [...new Set(history.map((h) => h.record_id))];
  if (records.length < SUGGEST.minSupport) return [];
  const rows = history.map((h) => ({ ...h, tokens: tokenize(h.description) })).filter((h) => h.tokens.length >= 3);
  const draft = draftTasks.map((t) => tokenize(t.description)).filter((t) => t.length);
  const idf = buildIdf([...rows.map((r) => r.tokens), ...draft]);
  const vecs = rows.map((r) => vectorize(r.tokens, idf));
  const draftVecs = draft.map((t) => vectorize(t, idf));

  // Greedy grouping of similar tasks across records.
  const used = new Set();
  const groups = [];
  for (let i = 0; i < rows.length; i += 1) {
    if (used.has(i)) continue;
    const members = [i]; used.add(i);
    for (let j = i + 1; j < rows.length; j += 1) {
      if (!used.has(j) && cosine(vecs[i], vecs[j]) >= SUGGEST.similarity) { members.push(j); used.add(j); }
    }
    const support = new Set(members.map((m) => rows[m].record_id)).size;
    if (support < SUGGEST.minSupport) continue;
    if (draftVecs.some((d) => cosine(d, vecs[i]) >= SUGGEST.similarity)) continue;
    const latest = members.map((m) => rows[m]).sort((a, b) => new Date(b.shift_start) - new Date(a.shift_start))[0];
    const prio = {};
    members.forEach((m) => { prio[rows[m].priority] = (prio[rows[m].priority] || 0) + 1; });
    groups.push({
      id: idFor(latest.description),
      text: latest.description,
      priority: Object.keys(prio).sort((a, b) => prio[b] - prio[a])[0],
      support,
      of: records.length,
      last_seen: new Date(latest.shift_start).toISOString(),
    });
  }
  return groups.sort((a, b) => b.support - a.support || new Date(b.last_seen) - new Date(a.last_seen)).slice(0, SUGGEST.maxSuggestions);
}

module.exports = { suggestTasks, idFor };

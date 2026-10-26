// Text tools for the handover assistant (Part S). Plain JavaScript, no external
// service and no model download: handover text never leaves the server.
//
//   tokenize(text)            -> content tokens (lower case, synonyms folded, light stemming)
//   buildIdf(docs)            -> Map term -> inverse document frequency
//   vectorize(text, idf)      -> L2-normalised TF-IDF Map
//   cosine(a, b)              -> similarity 0..1
//
// The stemmer is deliberately light (plural and -ing/-ed endings) so that
// "leaking", "leaks" and "leaked" meet, without pretending to be a full
// linguistic analyser. A short aviation synonym table folds common
// abbreviations ("a/c", "hyd", "eng") into one term.

const STOP = new Set((
  'a an and are as at be been but by for from had has have he her his i if in into is it its of on or our she so '
  + 'that the their them then there these they this to up was we were will with you your not no yes also just '
  + 'than too very can could should would may might do does did done get got any all some more most other such '
  + 'out over under again further once here when where why how what which who whom while about after before '
  + 'during between through above below off per via one two'
).split(' '));

// Terms that carry little meaning in handover text on their own.
const GENERIC = new Set(['issue', 'problem', 'check', 'shift', 'report', 'please', 'ensure', 'follow', 'update', 'note', 'noted', 'need', 'needs', 'needed', 'pending', 'open', 'ongoing', 'continue']);

// Folded before stemming. Keys are lower case.
const SYNONYMS = {
  ac: 'aircraft', acft: 'aircraft', plane: 'aircraft', airplane: 'aircraft', aeroplane: 'aircraft',
  hyd: 'hydraulic', hydraulics: 'hydraulic',
  eng: 'engine', engines: 'engine',
  gpu: 'gpu',
  apu: 'apu',
  maint: 'maintenance', mx: 'maintenance',
  pax: 'passenger', passengers: 'passenger',
  bag: 'baggage', bags: 'baggage', luggage: 'baggage',
  refuelling: 'refuel', refueling: 'refuel', fuelling: 'refuel', fueling: 'refuel', fuel: 'refuel',
  tyre: 'tire', tyres: 'tire', tires: 'tire',
  unserviceable: 'unserviceable', u_s: 'unserviceable', us: 'unserviceable',
  delayed: 'delay', delays: 'delay',
  leaking: 'leak', leaks: 'leak', leaked: 'leak',
  broken: 'fault', faulty: 'fault', defect: 'fault', defective: 'fault', failure: 'fault', failed: 'fault', malfunction: 'fault',
  inspect: 'inspection', inspected: 'inspection', inspecting: 'inspection',
};

function stem(word) {
  let w = word;
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1); // refuell -> refuel
  return w;
}

function tokenize(text, { keepGeneric = false } = {}) {
  if (!text) return [];
  const folded = String(text).toLowerCase().replace(/\ba\/c\b/g, 'aircraft').replace(/\bu\/s\b/g, 'unserviceable');
  const out = [];
  for (const raw of folded.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (STOP.has(raw)) continue;
    const base = SYNONYMS[raw] ?? raw;
    if (base.length < 2 && !/^\d$/.test(base)) continue;
    const t = SYNONYMS[base] ?? stem(base);
    if (!keepGeneric && GENERIC.has(t)) continue;
    out.push(t);
  }
  return out;
}

function termFrequencies(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

// Smoothed IDF: ln((N + 1) / (df + 1)) + 1, so no term has weight zero.
function buildIdf(docs) {
  const df = new Map();
  for (const doc of docs) {
    for (const t of new Set(typeof doc === 'string' ? tokenize(doc) : doc)) df.set(t, (df.get(t) || 0) + 1);
  }
  const n = docs.length;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log((n + 1) / (d + 1)) + 1);
  idf.defaultWeight = Math.log(n + 1) + 1; // for a term never seen in the corpus
  return idf;
}

function vectorize(textOrTokens, idf) {
  const tokens = typeof textOrTokens === 'string' ? tokenize(textOrTokens) : textOrTokens;
  const tf = termFrequencies(tokens);
  const vec = new Map();
  let norm = 0;
  for (const [t, c] of tf) {
    const w = (1 + Math.log(c)) * (idf.get(t) ?? idf.defaultWeight ?? 1);
    vec.set(t, w);
    norm += w * w;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [t, w] of vec) vec.set(t, w / norm);
  return vec;
}

function cosine(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  for (const [t, w] of small) { const o = large.get(t); if (o) dot += w * o; }
  return Math.min(1, dot);
}

// Number of content tokens two texts share (generic words excluded).
function sharedTokens(a, b) {
  const sb = new Set(typeof b === 'string' ? tokenize(b) : b);
  const seen = new Set();
  for (const t of (typeof a === 'string' ? tokenize(a) : a)) if (sb.has(t)) seen.add(t);
  return [...seen];
}

module.exports = {
  tokenize, buildIdf, vectorize, cosine, sharedTokens, stem,
};

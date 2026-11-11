// Phase 2: decides whether a submitted handover can be released to the
// incoming shift automatically or must be held for supervisor approval.
// Pure and rule-based, like quality.js: every hold carries a plain reason.
//
//   evaluateRelease({ summary, tasks, incidents }) -> { hold, reasons }
//
// tasks:     [{ description }]
// incidents: [{ title, description, severity }]
//
// Deliberately conservative (HOLD in ./constants.js): negations such as
// "no injuries" still hold, because a summary that needs to say so is one a
// supervisor should look at. A false hold costs one approval click; a false
// release is the dangerous error. Fail-safe behaviour (assistant disabled,
// evaluation throwing, flag off => HELD) lives in the caller, not here.
const { HOLD } = require('./constants');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A stem term matches at a word boundary and may continue into the word
// ("injur" -> injured); internal spaces also match hyphens or any whitespace.
const stemPattern = (term) => `\\b${escape(term).replace(/ /g, '[\\s-]+')}`;
const exactPattern = (term) => `\\b${escape(term)}\\b`;

const TERM_REGEX = [
  ...HOLD.terms.map((t) => ({ term: t, re: new RegExp(stemPattern(t), 'i') })),
  ...HOLD.exactTerms.map((t) => ({ term: t.toUpperCase(), re: new RegExp(exactPattern(t), 'i') })),
];

function scanText(text, field, found) {
  const s = String(text || '');
  if (!s) return;
  for (const { term, re } of TERM_REGEX) {
    if (!found.has(term) && re.test(s)) {
      found.set(term, { code: 'keyword', term, field, text: `contains the word '${term}'` });
    }
  }
}

function evaluateRelease({ summary = '', tasks = [], incidents = [] } = {}) {
  const reasons = [];

  // Rule (a): serious incidents always hold.
  for (const inc of incidents) {
    if (HOLD.severities.includes(inc.severity)) {
      reasons.push({
        code: 'incident_severity',
        severity: inc.severity,
        text: `${inc.severity} incident '${String(inc.title || '').slice(0, 60)}'`,
      });
    }
  }

  // Rule (b): hazard wording anywhere the next shift will read.
  const found = new Map();
  scanText(summary, 'summary', found);
  for (const t of tasks) scanText(t.description, 'tasks', found);
  for (const i of incidents) scanText(`${i.title || ''} ${i.description || ''}`, 'incidents', found);
  reasons.push(...found.values());

  return { hold: reasons.length > 0, reasons: reasons.slice(0, HOLD.maxReasons) };
}

module.exports = { evaluateRelease };

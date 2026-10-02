/**
 * Validates a handover record against its department's handover_template.
 *
 * field_definition format:
 *   {
 *     "fields": [
 *       { "key": "summary_notes", "label": "...", "type": "text", "required": true, "minLength": 20 },
 *       { "key": "tasks",         "label": "...", "type": "list", "required": true, "minItems": 1 },
 *       { "key": "incidents",     "label": "...", "type": "list", "required": false }
 *     ]
 *   }
 *
 * Keys map onto the columns/child tables the schema provides for a record.
 */
const TEMPLATE_KEYS = {
  summary_notes: 'text',
  tasks: 'list',
  incidents: 'list',
};

// Checks the shape of a field_definition (used by the admin template editor).
// Returns a list of problems; empty means valid.
function checkFieldDefinition(def) {
  const problems = [];
  if (!def || typeof def !== 'object' || !Array.isArray(def.fields)) {
    return ['field_definition must be an object with a "fields" array'];
  }
  const seen = new Set();
  def.fields.forEach((f, i) => {
    const at = `fields[${i}]`;
    if (!f || typeof f !== 'object') return problems.push(`${at} must be an object`);
    if (!(f.key in TEMPLATE_KEYS)) {
      problems.push(`${at}.key must be one of ${Object.keys(TEMPLATE_KEYS).join(', ')}`);
    } else if (seen.has(f.key)) {
      problems.push(`${at}.key '${f.key}' is duplicated`);
    } else {
      seen.add(f.key);
      if (f.type !== undefined && f.type !== TEMPLATE_KEYS[f.key]) {
        problems.push(`${at}.type for '${f.key}' must be '${TEMPLATE_KEYS[f.key]}'`);
      }
    }
    if (typeof f.label !== 'string' || !f.label.trim()) problems.push(`${at}.label is required`);
    if (f.required !== undefined && typeof f.required !== 'boolean') problems.push(`${at}.required must be boolean`);
    for (const n of ['minLength', 'minItems']) {
      if (f[n] !== undefined && !(Number.isInteger(f[n]) && f[n] >= 0)) problems.push(`${at}.${n} must be a non-negative integer`);
    }
    return undefined;
  });
  return problems;
}

/**
 * Returns the list of template-mandated fields the record fails, each as
 * { field, label, reason }. `content` = { summary_notes, tasks: [], incidents: [] }.
 */
function findMissingFields(fieldDefinition, content) {
  const missing = [];
  for (const f of fieldDefinition.fields || []) {
    if (!f.required) continue;
    const label = f.label || f.key;

    if (TEMPLATE_KEYS[f.key] === 'text') {
      const value = (content[f.key] || '').trim();
      if (!value) {
        missing.push({ field: f.key, label, reason: 'required' });
      } else if (f.minLength && value.length < f.minLength) {
        missing.push({ field: f.key, label, reason: `must be at least ${f.minLength} characters (has ${value.length})` });
      }
    } else if (TEMPLATE_KEYS[f.key] === 'list') {
      const count = (content[f.key] || []).length;
      const min = f.minItems ?? 1;
      if (count < min) {
        missing.push({ field: f.key, label, reason: `at least ${min} required (has ${count})` });
      }
    }
  }
  return missing;
}

module.exports = { TEMPLATE_KEYS, checkFieldDefinition, findMissingFields };

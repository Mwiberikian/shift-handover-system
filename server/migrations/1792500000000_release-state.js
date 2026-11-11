/**
 * Phase 2: automatic release of handover reports, with holds.
 *
 * Adds a release decision alongside (never replacing) the existing status
 * state machine:
 *   - release_state: 'auto_released' | 'held' | 'approved' (nullable, so every
 *     existing row is untouched and reads as "recorded before this feature").
 *   - released_at: when the record became visible as released (set on
 *     auto-release and on supervisor approval).
 *   - release_reasons: why the record was held or released, at most 1 KB
 *     (same cap as assistant_event.payload).
 *
 * Additive and reversible: no existing column, constraint or trigger changes.
 * The handover_record_guard trigger locks only the original content columns
 * by name, so these new columns stay writable on submitted records (a
 * supervisor approval must be recordable after submission).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('handover_record', {
    release_state: { type: 'varchar(16)' },
    released_at: { type: 'timestamptz' },
    release_reasons: { type: 'jsonb' },
  });
  pgm.addConstraint('handover_record', 'handover_record_release_state_check', {
    check: "release_state IS NULL OR release_state IN ('auto_released', 'held', 'approved')",
  });
  pgm.addConstraint('handover_record', 'handover_record_release_reasons_small', {
    check: 'release_reasons IS NULL OR pg_column_size(release_reasons) <= 1024',
  });
};

exports.down = (pgm) => {
  pgm.dropConstraint('handover_record', 'handover_record_release_reasons_small');
  pgm.dropConstraint('handover_record', 'handover_record_release_state_check');
  pgm.dropColumns('handover_record', ['release_state', 'released_at', 'release_reasons']);
};

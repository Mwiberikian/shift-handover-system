/**
 * Handover assistant events (Part S). One row each time a person sees, takes
 * or dismisses something the assistant offered: a quality flag, a suggested
 * task, a severity suggestion, a recurring-issue notice. They exist so that
 * usefulness can be measured (how often is a suggestion taken, how often is a
 * flag dismissed) and are never used to judge a person.
 *
 *  - Append-only (the existing append_only_guard() trigger), like audit_log.
 *  - payload holds codes and counts only, never handover text.
 *  - Foreign keys are ON DELETE RESTRICT, like every other table.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('assistant_event', {
    event_id: { type: 'bigserial', primaryKey: true },
    user_id: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'RESTRICT' },
    record_id: { type: 'uuid', references: 'handover_record', onDelete: 'RESTRICT' },
    kind: { type: 'varchar(40)', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('assistant_event', 'assistant_event_kind_check', {
    check: `kind IN ('flags_shown','flag_dismissed','submitted_with_flags','suggestion_shown','suggestion_accepted','suggestion_dismissed','severity_suggested','severity_accepted','severity_overridden','recurring_shown','search_run','digest_opened')`,
  });
  pgm.addConstraint('assistant_event', 'assistant_event_payload_small', { check: 'pg_column_size(payload) <= 1024' });
  pgm.createIndex('assistant_event', ['user_id', 'created_at']);
  pgm.createIndex('assistant_event', ['kind', 'created_at']);
  pgm.sql(`
    CREATE TRIGGER trg_assistant_event_append_only
      BEFORE UPDATE OR DELETE ON assistant_event
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_assistant_event_append_only ON assistant_event');
  pgm.dropTable('assistant_event');
};

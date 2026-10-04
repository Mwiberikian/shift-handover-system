/**
 * Shift reminders.
 *
 *  - shift_assignment: who is rostered on a shift (managed by supervisors for
 *    their department, admins for any).
 *  - reminder_log: one row per reminder sent, unique on
 *    (reminder_type, ref_id, user_id). The scheduler inserts here first and
 *    only notifies if the insert succeeded, so a restart or overlapping tick
 *    can never send a duplicate. Append-only.
 *  - notification gains title/body text, the reminder type and an optional
 *    shift link, so reminders can be shown without extra lookups.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table) => ({ references: table, onDelete: 'RESTRICT' });

exports.up = (pgm) => {
  pgm.createTable('shift_assignment', {
    shift_id: { type: 'uuid', notNull: true, primaryKey: true, ...fk('shift') },
    user_id: { type: 'uuid', notNull: true, primaryKey: true, ...fk('app_user') },
  });
  pgm.createIndex('shift_assignment', 'user_id');

  pgm.createTable('reminder_log', {
    reminder_type: { type: 'varchar(40)', notNull: true },
    ref_id: { type: 'uuid', notNull: true },
    user_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    sent_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
  });
  pgm.addConstraint('reminder_log', 'reminder_log_once', { unique: ['reminder_type', 'ref_id', 'user_id'] });

  pgm.addColumns('notification', {
    title: { type: 'varchar(160)' },
    body: { type: 'varchar(500)' },
    reminder_type: { type: 'varchar(40)' },
    shift_id: { type: 'uuid', ...fk('shift') },
  });

  pgm.sql(`
    CREATE TRIGGER trg_reminder_log_append_only
      BEFORE UPDATE OR DELETE ON reminder_log
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_reminder_log_append_only ON reminder_log');
  pgm.dropColumns('notification', ['title', 'body', 'reminder_type', 'shift_id']);
  pgm.dropTable('reminder_log');
  pgm.dropTable('shift_assignment');
};

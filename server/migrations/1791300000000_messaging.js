/**
 * Messaging: direct messages, department broadcasts and organisation-wide
 * broadcasts.
 *
 *  - message is append-only (no UPDATE/DELETE), enforced by the existing
 *    append_only_guard() trigger function from the initial migration.
 *  - Exactly the recipient column matching recipient_type is set (CHECK).
 *  - message_read records per-user read state, so a broadcast to many people
 *    tracks each reader separately. Reads are insert-once, also append-only.
 *  - Direct messages raise a notification (type 'message'); notification gains
 *    an optional message_id for that link.
 *
 * Who may send what (cross-department direct messages are deliberate; see the
 * README) is enforced in the API, not here.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table) => ({ references: table, onDelete: 'RESTRICT' });

exports.up = (pgm) => {
  pgm.createType('message_recipient_enum', ['user', 'department', 'organisation']);

  pgm.createTable('message', {
    message_id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    sender_id: { type: 'uuid', notNull: true, ...fk('app_user') },
    recipient_type: { type: 'message_recipient_enum', notNull: true },
    recipient_user_id: { type: 'uuid', ...fk('app_user') },
    recipient_department_id: { type: 'uuid', ...fk('department') },
    subject: { type: 'varchar(160)' },
    body: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
  });
  pgm.addConstraint('message', 'message_body_length', {
    check: 'char_length(btrim(body)) BETWEEN 1 AND 2000',
  });
  pgm.addConstraint('message', 'message_recipient_matches_type', {
    check: `(recipient_type = 'user' AND recipient_user_id IS NOT NULL AND recipient_department_id IS NULL)
         OR (recipient_type = 'department' AND recipient_department_id IS NOT NULL AND recipient_user_id IS NULL)
         OR (recipient_type = 'organisation' AND recipient_user_id IS NULL AND recipient_department_id IS NULL)`,
  });
  pgm.createIndex('message', ['recipient_user_id', 'created_at']);
  pgm.createIndex('message', ['recipient_department_id', 'created_at']);
  pgm.createIndex('message', ['sender_id', 'created_at']);
  pgm.createIndex('message', ['recipient_type', 'created_at']);

  pgm.createTable('message_read', {
    message_id: { type: 'uuid', notNull: true, primaryKey: true, ...fk('message') },
    user_id: { type: 'uuid', notNull: true, primaryKey: true, ...fk('app_user') },
    read_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
  });

  pgm.addColumn('notification', { message_id: { type: 'uuid', ...fk('message') } });

  pgm.sql(`
    CREATE TRIGGER trg_message_append_only
      BEFORE UPDATE OR DELETE ON message
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
    CREATE TRIGGER trg_message_read_append_only
      BEFORE UPDATE OR DELETE ON message_read
      FOR EACH ROW EXECUTE FUNCTION append_only_guard();
  `);
};

exports.down = (pgm) => {
  pgm.sql('DROP TRIGGER IF EXISTS trg_message_read_append_only ON message_read');
  pgm.sql('DROP TRIGGER IF EXISTS trg_message_append_only ON message');
  pgm.dropColumn('notification', 'message_id');
  pgm.dropTable('message_read');
  pgm.dropTable('message');
  pgm.dropType('message_recipient_enum');
};

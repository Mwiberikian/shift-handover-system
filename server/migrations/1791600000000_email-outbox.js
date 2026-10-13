/**
 * Email outbox (IR-05, IR-06, IR-07).
 *
 *  - email_outbox: one queued email per notification. The notification's own
 *    transaction only inserts this row; the jobs tick sends it later, outside
 *    that transaction, so a slow or broken mail gateway can never hold up or
 *    roll back a handover.
 *  - status pending -> sent | failed. A failed send is retried up to three
 *    times with exponential backoff (attempts counts every try, so a row ends
 *    'failed' after 4 attempts).
 *  - notification.email_status / email_status_at record the outcome against
 *    the notification itself (IR-06): pending while queued, then sent or
 *    failed.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table) => ({ references: table, onDelete: 'RESTRICT' });

exports.up = (pgm) => {
  pgm.createType('email_status_enum', ['pending', 'sent', 'failed']);

  pgm.createTable('email_outbox', {
    id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    notification_id: { type: 'uuid', notNull: true, unique: true, ...fk('notification') },
    to_address: { type: 'varchar(160)', notNull: true },
    subject: { type: 'varchar(200)', notNull: true },
    status: { type: 'email_status_enum', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    last_error: { type: 'varchar(500)' },
    next_attempt_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
    sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
  });
  pgm.addConstraint('email_outbox', 'email_outbox_attempts_range', { check: 'attempts BETWEEN 0 AND 4' });
  pgm.createIndex('email_outbox', ['status', 'next_attempt_at']);

  pgm.addColumns('notification', {
    email_status: { type: 'email_status_enum' },
    email_status_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('notification', ['email_status', 'email_status_at']);
  pgm.dropTable('email_outbox');
  pgm.dropType('email_status_enum');
};

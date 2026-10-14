/**
 * Web Push subscriptions (Part R3). One row per browser or installed app that
 * turned on "Push notifications on this device". endpoint is the push
 * service URL the browser gave us (unique: a device belongs to one user at a
 * time); p256dh and auth are the keys that encrypt each payload for it.
 * last_success_at and failed_count record delivery; a subscription the push
 * service reports gone (404 or 410) is deleted.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('push_subscription', {
    id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    user_id: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    endpoint: { type: 'text', notNull: true, unique: true },
    p256dh: { type: 'text', notNull: true },
    auth: { type: 'text', notNull: true },
    user_agent: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_success_at: { type: 'timestamptz' },
    failed_count: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.addConstraint('push_subscription', 'push_subscription_endpoint_https', "CHECK (endpoint LIKE 'https://%')");
  pgm.createIndex('push_subscription', 'user_id');
};

exports.down = (pgm) => {
  pgm.dropTable('push_subscription');
};

/**
 * Per-user switch for email alerts (IR-05). On by default; the user turns it
 * off from their menu. In-app notifications are not affected.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('app_user', {
    email_notifications: { type: 'boolean', notNull: true, default: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('app_user', 'email_notifications');
};

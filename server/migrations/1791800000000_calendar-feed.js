/**
 * Calendar subscription feed (Part K). A user may have one feed token: 32
 * random bytes, shown to them once. Only its SHA-256 is stored, so a database
 * copy cannot be used to read anyone's feed. Revoking clears the hash;
 * regenerating replaces it.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('app_user', {
    calendar_feed_hash: { type: 'char(64)', unique: true },
    calendar_feed_created_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('app_user', ['calendar_feed_hash', 'calendar_feed_created_at']);
};

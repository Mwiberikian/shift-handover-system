/**
 * Per-user theme (Part R1): light, dark or system (follow the device). Kept on
 * the server so the same user sees the same theme on every device; the client
 * applies it at sign-in and caches it locally for the next first paint.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('app_user', {
    theme_preference: {
      type: 'text', notNull: true, default: 'system', check: "theme_preference IN ('light', 'dark', 'system')",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('app_user', 'theme_preference');
};

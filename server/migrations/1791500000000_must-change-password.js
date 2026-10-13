/**
 * NFR-05: an account created from an access request starts with a temporary
 * password that its owner must replace at first sign-in. While
 * must_change_password is true the API refuses everything except
 * GET /api/auth/me and POST /api/auth/change-password.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('app_user', {
    must_change_password: { type: 'boolean', notNull: true, default: false },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('app_user', 'must_change_password');
};

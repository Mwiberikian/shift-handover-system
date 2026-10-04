/**
 * Links an app_user to a Google account for "Sign in with Google".
 *
 * google_sub is Google's stable subject id. It is nullable (most accounts are
 * never linked) and unique, so one Google account maps to at most one user.
 * Linking only ever attaches Google to an existing, admin-created account:
 * Google sign-in never creates users or assigns roles (FR-01).
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('app_user', {
    google_sub: { type: 'varchar(255)', unique: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('app_user', 'google_sub');
};

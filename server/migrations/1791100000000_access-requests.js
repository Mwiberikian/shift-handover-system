/**
 * Access requests: a public "request access" form that replaces open sign-up.
 *
 * A row here never grants access by itself. Only an admin approving it creates
 * an app_user (with the role and department the admin chooses), and the
 * request then records who approved it and which account it produced.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

const fk = (table, column) => ({ references: column ? `${table}(${column})` : table, onDelete: 'RESTRICT' });

exports.up = (pgm) => {
  pgm.createType('access_request_status_enum', ['pending', 'approved', 'rejected']);

  pgm.createTable('access_request', {
    request_id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    full_name: { type: 'varchar(120)', notNull: true },
    email: { type: 'varchar(160)', notNull: true },
    staff_number: { type: 'varchar(20)' },
    requested_department_code: { type: 'varchar(10)', notNull: true, ...fk('department', 'code') },
    note: { type: 'text' },
    status: { type: 'access_request_status_enum', notNull: true, default: 'pending' },
    reviewed_by: { type: 'uuid', ...fk('app_user') },
    reviewed_at: { type: 'timestamptz' },
    // Optional reason given by the admin when rejecting.
    review_reason: { type: 'text' },
    // The account created when the request was approved.
    user_id: { type: 'uuid', ...fk('app_user') },
    created_at: { type: 'timestamptz', notNull: true, default: { literal: true, value: 'now()' } },
  });

  // Review fields are set exactly when the request has been decided, and only
  // an approved request points at a created account.
  pgm.addConstraint('access_request', 'access_request_review_consistency', {
    check: `(status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND user_id IS NULL)
         OR (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND user_id IS NOT NULL)
         OR (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND user_id IS NULL)`,
  });

  // At most one open request per email address.
  pgm.createIndex('access_request', 'lower(email)', {
    name: 'access_request_one_pending_per_email',
    unique: true,
    where: "status = 'pending'",
  });
  pgm.createIndex('access_request', ['status', 'created_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('access_request');
  pgm.dropType('access_request_status_enum');
};

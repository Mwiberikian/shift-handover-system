/**
 * Passkeys (WebAuthn), an additional way to sign in to an existing account.
 *
 * passkey_credential: one row per passkey. public_key is the credential's
 * public key only; biometrics and private keys never leave the device. counter
 * is the authenticator's signature counter (synced passkeys always report 0).
 *
 * webauthn_challenge: the challenge of each ceremony, kept here so it survives
 * restarts. Valid for 5 minutes and used once; expired rows are purged when new
 * options are issued. user_id is null for sign-in, which needs no username.
 *
 * @param pgm {import('node-pg-migrate').MigrationBuilder}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('passkey_credential', {
    id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    credential_id: { type: 'text', notNull: true, unique: true },
    user_id: { type: 'uuid', notNull: true, references: 'app_user', onDelete: 'CASCADE' },
    public_key: { type: 'bytea', notNull: true },
    counter: { type: 'bigint', notNull: true, default: 0 },
    transports: { type: 'text[]', notNull: true, default: '{}' },
    device_type: { type: 'text', notNull: true },
    backed_up: { type: 'boolean', notNull: true, default: false },
    label: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    last_used_at: { type: 'timestamptz' },
  });
  pgm.createIndex('passkey_credential', 'user_id');

  pgm.createTable('webauthn_challenge', {
    id: { type: 'uuid', primaryKey: true, default: { literal: true, value: 'gen_random_uuid()' } },
    challenge: { type: 'text', notNull: true },
    user_id: { type: 'uuid', references: 'app_user', onDelete: 'CASCADE' },
    purpose: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    used: { type: 'boolean', notNull: true, default: false },
  });
  pgm.addConstraint('webauthn_challenge', 'webauthn_challenge_purpose', "CHECK (purpose IN ('register', 'login'))");
  pgm.createIndex('webauthn_challenge', 'expires_at');
};

exports.down = (pgm) => {
  pgm.dropTable('webauthn_challenge');
  pgm.dropTable('passkey_credential');
};

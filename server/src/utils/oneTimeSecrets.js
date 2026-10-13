// Holds a secret in this process's memory until it is read once or expires.
// Used for the temporary password of an approved access request (NFR-05): it
// is never written to the database, a log or a normal API response. The
// approving admin gets a random reveal token and exchanges it exactly once.
//
// Memory only, by design: a restart (or a second API process) forgets every
// pending secret. The admin can then set a new password for the user.
const crypto = require('crypto');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const store = new Map();

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function sweep(now = Date.now()) {
  for (const [key, entry] of store) if (entry.expiresAt <= now) store.delete(key);
}

// Returns { token, expiresAt }. `owner` must match on take().
function put(secret, owner, ttlMs = DEFAULT_TTL_MS) {
  sweep();
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + ttlMs;
  store.set(hash(token), { secret, owner, expiresAt });
  return { token, expiresAt: new Date(expiresAt) };
}

// The secret, once; null if unknown, expired, already taken or not the owner's.
// A wrong owner does not consume it.
function take(token, owner) {
  sweep();
  if (typeof token !== 'string') return null;
  const key = hash(token);
  const entry = store.get(key);
  if (!entry || entry.owner !== owner) return null;
  store.delete(key);
  return entry.secret;
}

const size = () => store.size;
const clear = () => store.clear();

module.exports = {
  put, take, size, clear, DEFAULT_TTL_MS,
};

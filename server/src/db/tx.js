const pool = require('../config/db');
const logger = require('../utils/logger');

// Work that must only happen once the transaction has committed (sending a
// push notification, for example): nothing is sent for a change that rolls
// back. Returns the function that runs the queue; call it after COMMIT.
function trackAfterCommit(client) {
  const queue = [];
  client.afterCommit = (fn) => queue.push(fn);
  return () => {
    delete client.afterCommit;
    for (const fn of queue) {
      Promise.resolve().then(fn).catch((err) => logger.warn(`[after-commit] ${err.message}`));
    }
  };
}

// Queues fn to run after db's transaction commits. db is the pool (each query
// commits on its own, so fn runs on the next tick) or a client from
// withTransaction (or another caller that used trackAfterCommit).
function afterCommit(db, fn) {
  if (typeof db.afterCommit === 'function') db.afterCommit(fn);
  else if (db === pool) setImmediate(() => Promise.resolve().then(fn).catch((err) => logger.warn(`[after-commit] ${err.message}`)));
  else throw new Error('afterCommit: the client is not in a tracked transaction');
}

// Runs fn(client) inside BEGIN/COMMIT on a single connection. Anything that
// throws rolls back the whole unit of work, including its audit_log rows.
async function withTransaction(fn) {
  const client = await pool.connect();
  const runAfterCommit = trackAfterCommit(client);
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    runAfterCommit();
    return result;
  } catch (err) {
    delete client.afterCommit;
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction, trackAfterCommit, afterCommit };

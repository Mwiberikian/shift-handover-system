const pool = require('../config/db');

// Runs fn(client) inside BEGIN/COMMIT on a single connection. Anything that
// throws rolls back the whole unit of work, including its audit_log rows.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };

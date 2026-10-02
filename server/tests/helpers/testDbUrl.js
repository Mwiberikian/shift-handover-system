const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });

// Tests run against a separate database so they never touch dev data.
// TEST_DATABASE_URL wins; otherwise DATABASE_URL with the db name -> shms_test.
function testDbUrl() {
  const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
  if (!process.env.TEST_DATABASE_URL) url.pathname = '/shms_test';
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against '${dbName}': test database name must end in _test`);
  }
  return url.toString();
}

module.exports = { testDbUrl };

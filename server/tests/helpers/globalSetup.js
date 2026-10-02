// Creates the test database if needed and migrates it to the latest schema.
const { execSync } = require('child_process');
const path = require('path');
const { Client } = require('pg');
const { testDbUrl } = require('./testDbUrl');

module.exports = async () => {
  const url = new URL(testDbUrl());
  const dbName = url.pathname.slice(1);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rows.length) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execSync('npx node-pg-migrate up', {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
};

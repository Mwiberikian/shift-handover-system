// The seed wipes the database with one TRUNCATE. Postgres refuses it if any
// table that references another is left out, so every table in the schema
// must be listed (R3 added push_subscription and broke the seed until it was).
const fs = require('fs');
const path = require('path');
const { pool } = require('./helpers/fixtures');

afterAll(() => pool.end());

const listed = (file) => {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  // The SQL starts a template literal; comments mentioning TRUNCATE don't.
  const m = /`\s*TRUNCATE ([\s\S]*?)\s+RESTART IDENTITY/.exec(code);
  return new Set(m[1].split(',').map((t) => t.trim()));
};

test.each([['../src/db/seeds/seed.js'], ['./helpers/fixtures.js']])('%s truncates every application table', async (file) => {
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'pgmigrations'",
  );
  const tables = listed(file);
  expect(rows.map((r) => r.table_name).filter((t) => !tables.has(t)).sort()).toEqual([]);
});

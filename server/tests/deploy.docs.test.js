// P3: docs/DEPLOY.md stays in step with the code. Every environment variable
// the server reads is in its table, and it says the jobs need an always-on
// instance.
const fs = require('fs');
const path = require('path');

const deploy = fs.readFileSync(path.join(__dirname, '../../docs/DEPLOY.md'), 'utf8');
const srcDir = path.join(__dirname, '../src');

function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? filesIn(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .filter((f) => f.endsWith('.js'));
}

// process.env.X, env.X, env['X'], and the reminder helper minutes('X', ...).
function envNamesReadByServer() {
  const names = new Set();
  for (const file of filesIn(srcDir)) {
    const code = fs.readFileSync(file, 'utf8');
    for (const re of [/\benv\.([A-Z][A-Z0-9_]+)/g, /\benv\[['"]([A-Z][A-Z0-9_]+)['"]\]/g, /\bminutes\(['"]([A-Z][A-Z0-9_]+)['"]/g]) {
      for (const m of code.matchAll(re)) names.add(m[1]);
    }
  }
  return [...names].sort();
}

const tableRows = new Set([...deploy.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]));

test('the env table lists every variable the server reads', () => {
  const names = envNamesReadByServer();
  expect(names.length).toBeGreaterThan(20);
  expect(names.filter((n) => !tableRows.has(n))).toEqual([]);
});

test('the env table lists the client build variables', () => {
  const clientExample = fs.readFileSync(path.join(__dirname, '../../client/.env.example'), 'utf8');
  const names = [...clientExample.matchAll(/^(VITE_[A-Z0-9_]+)=/gm)].map((m) => m[1]);
  expect(names.filter((n) => !tableRows.has(n))).toEqual([]);
});

test('covers the static client, the API container and managed Postgres 15', () => {
  expect(deploy).toMatch(/## 1\. Database: managed PostgreSQL 15/);
  expect(deploy).toMatch(/## 2\. API: the container/);
  expect(deploy).toMatch(/## 3\. Client: the static site/);
  expect(deploy).toMatch(/## First-deploy checklist/);
  expect(deploy).toMatch(/npm run migrate up/);
});

test('says the in-process jobs need an always-on instance', () => {
  expect(deploy).toMatch(/needs an always-on instance/);
  expect(deploy).toMatch(/sleep[\s\S]{0,120}will miss reminders/);
});

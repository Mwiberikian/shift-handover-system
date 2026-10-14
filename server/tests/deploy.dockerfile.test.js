// P1: the API image. Static checks on server/Dockerfile and .dockerignore; the
// image itself was built and run by hand (docs/DEPLOY.md).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const instructions = dockerfile
  .replace(/\\r?\n/g, ' ')
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));
const ignore = fs.readFileSync(path.join(root, '.dockerignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
const pkg = require('../package.json');

test('builds from node 22 on Alpine', () => {
  expect(instructions[0]).toMatch(/^FROM node:22-alpine$/);
});

test('runs as a non-root user', () => {
  const users = instructions.filter((l) => l.startsWith('USER '));
  expect(users.length).toBeGreaterThan(0);
  expect(users.at(-1)).not.toMatch(/^USER (root|0)\b/);
  // The USER line comes before CMD, so the server process is unprivileged.
  expect(instructions.indexOf(users.at(-1))).toBeLessThan(instructions.findIndex((l) => l.startsWith('CMD ')));
});

test('has a healthcheck on /api/health', () => {
  const hc = instructions.find((l) => l.startsWith('HEALTHCHECK '));
  expect(hc).toMatch(/\/api\/health/);
});

test('starts the server without running migrations', () => {
  const cmd = instructions.find((l) => l.startsWith('CMD '));
  expect(cmd).toBe('CMD ["node", "src/server.js"]');
  expect(instructions.some((l) => l.startsWith('ENTRYPOINT '))).toBe(false);
  expect(instructions.filter((l) => /^(CMD|RUN|ENTRYPOINT) /.test(l)).join('\n')).not.toMatch(/migrate/);
});

test('the release command can run migrations from the image', () => {
  expect(pkg.scripts.migrate).toBe('node-pg-migrate');
  expect(pkg.dependencies['node-pg-migrate']).toBeDefined();
  expect(dockerfile).toMatch(/npm ci --omit=dev/);
  expect(instructions).toContain('COPY migrations ./migrations');
});

test('.dockerignore keeps secrets, tests and node_modules out', () => {
  for (const entry of ['.env', '.env.*', 'node_modules', 'tests']) expect(ignore).toContain(entry);
});

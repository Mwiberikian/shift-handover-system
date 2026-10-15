// NFR-18: the supported Node.js versions. Both packages declare Node 22 or
// later and CI tests on 22 and 24 (Node 18 and 20 are end of life, and the
// dependencies need 20 or 22: BUILD_REPORT, NFR-18).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test.each([['server'], ['client']])('%s/package.json and its lockfile require Node >=22', (pkg) => {
  expect(JSON.parse(read(`${pkg}/package.json`)).engines).toEqual({ node: '>=22' });
  expect(JSON.parse(read(`${pkg}/package-lock.json`)).packages[''].engines).toEqual({ node: '>=22' });
});

test('CI runs both jobs on Node 22 and 24 only', () => {
  const matrices = [...read('.github/workflows/ci.yml').matchAll(/^\s+node: \[(.*)\]$/gm)].map((m) => m[1]);
  expect(matrices).toEqual(['22, 24', '22, 24']);
});

test('the running Node satisfies the floor', () => {
  expect(Number(process.versions.node.split('.')[0])).toBeGreaterThanOrEqual(22);
});

test('the Docker image is on a supported Node', () => {
  expect(read('server/Dockerfile')).toMatch(/^FROM node:(22|24)-alpine/m);
});

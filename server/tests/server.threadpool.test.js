// server.js sets UV_THREADPOOL_SIZE to min(12, logical CPUs) before anything
// else loads, unless the environment already sets it. Starts the real entry
// point in a child process (port 0, reminders off under NODE_ENV=test) and
// reads the size it reports.
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

function startedWith(env) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env, PORT: '0', ...env };
    if (env.UV_THREADPOOL_SIZE === undefined) delete childEnv.UV_THREADPOOL_SIZE;
    const child = spawn(process.execPath, ['src/server.js'], { cwd: path.join(__dirname, '..'), env: childEnv });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no start-up line: ${out}`)); }, 15000);
    child.stdout.on('data', (d) => {
      out += d;
      const m = /UV_THREADPOOL_SIZE=(\d+)/.exec(out);
      if (m) { clearTimeout(timer); child.kill(); resolve(Number(m[1])); }
    });
    child.stderr.on('data', (d) => { out += d; });
  });
}

const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;

test('defaults to min(12, logical CPUs) when nothing sets it', async () => {
  expect(await startedWith({ UV_THREADPOOL_SIZE: undefined })).toBe(Math.min(12, cpus));
});

test('a value in the environment wins', async () => {
  expect(await startedWith({ UV_THREADPOOL_SIZE: '3' })).toBe(3);
});

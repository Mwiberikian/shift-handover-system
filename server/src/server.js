// libuv thread pool size. Must be settled before anything uses the pool
// (bcrypt, crypto, fs, dns), so this runs before every other require. bcrypt
// at cost 12 runs on this pool; the libuv default of 4 threads queues
// concurrent logins (BUILD_REPORT C5). Default: min(12, logical CPUs). A value
// already in the environment wins; so does one in .env (applied just below,
// still before the pool starts).
const os = require('os');

const THREADPOOL_FROM_ENV = Boolean(process.env.UV_THREADPOOL_SIZE);
if (!THREADPOOL_FROM_ENV) {
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  process.env.UV_THREADPOOL_SIZE = String(Math.min(12, cpus));
}

const { parsed: dotenvValues } = require('dotenv').config({ quiet: true });

if (!THREADPOOL_FROM_ENV && dotenvValues?.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = dotenvValues.UV_THREADPOOL_SIZE;
}
// In production, refuse to start on a missing or placeholder secret (P2).
const configErrors = require('./config/env').productionConfigErrors();
if (configErrors.length) {
  console.error(`Refusing to start in production:\n${configErrors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}

const app = require('./app');
const { startJobs } = require('./jobs/reminders');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT} (UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE})`);
});

// The jobs tick runs every minute: work sessions (always: ends silent and
// finished sessions, stops their timers), shift reminders
// (REMINDERS_ENABLED=false turns them off) and the email outbox (only when
// EMAIL_ENABLED=true). Never under tests, which call runSessionCheck /
// runReminderCheck / processOutbox with their own clock.
const reminders = process.env.REMINDERS_ENABLED !== 'false';
const email = process.env.EMAIL_ENABLED === 'true';
if (process.env.NODE_ENV !== 'test') {
  startJobs({ reminders, email, sessions: true });
  console.log(`Jobs started (every minute): sessions on, reminders ${reminders ? 'on' : 'off'}, email outbox ${email ? 'on' : 'off'}.`);
}

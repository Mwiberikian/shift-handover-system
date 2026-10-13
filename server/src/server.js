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
const app = require('./app');
const { startReminderScheduler } = require('./jobs/reminders');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT} (UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE})`);
});

// Shift reminders tick every minute. Never under tests (they call
// runReminderCheck directly with an injected clock); REMINDERS_ENABLED=false
// turns them off.
if (process.env.NODE_ENV !== 'test' && process.env.REMINDERS_ENABLED !== 'false') {
  startReminderScheduler();
  console.log('Shift reminder scheduler started (every minute).');
}

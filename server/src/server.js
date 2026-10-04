require('dotenv').config({ quiet: true });
const app = require('./app');
const { startReminderScheduler } = require('./jobs/reminders');

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});

// Shift reminders tick every minute. Never under tests (they call
// runReminderCheck directly with an injected clock); REMINDERS_ENABLED=false
// turns them off.
if (process.env.NODE_ENV !== 'test' && process.env.REMINDERS_ENABLED !== 'false') {
  startReminderScheduler();
  console.log('Shift reminder scheduler started (every minute).');
}

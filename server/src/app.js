const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');
const { clientOrigins, trustProxy } = require('./config/env');

const app = express();

// Behind the host's load balancer, so per-IP rate limits key on the client.
app.set('trust proxy', trustProxy());
app.use(helmet());
// CLIENT_ORIGIN may be a comma-separated list. Unset (development only, the
// server refuses to start without it in production) keeps the cors default.
const origins = clientOrigins();
app.use(cors({ origin: origins.length > 1 ? origins : origins[0] }));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use('/api/health', require('./modules/health/health.routes'));
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/handovers', require('./modules/handovers/handovers.routes'));
app.use('/api/dashboard', require('./modules/dashboard/dashboard.routes'));
app.use('/api/notifications', require('./modules/notifications/notifications.routes'));
app.use('/api/push', require('./modules/notifications/push/push.routes'));
const messages = require('./modules/messages/messages.routes');

app.use('/api/messages', messages);
app.use('/api/directory', messages.directory);
app.use('/api/shifts', require('./modules/shifts/shifts.routes'));
const sessions = require('./modules/sessions/sessions.routes');

app.use('/api/sessions', sessions.sessions);
app.use('/api/tasks', sessions.tasks);
app.use('/api/reports', require('./modules/reports/reports.routes'));
app.use('/api/admin', require('./modules/admin/admin.routes'));
// Public: unauthenticated, rate-limited request form (grants no access).
app.use('/api/access-requests', require('./modules/accessRequests/accessRequests.routes'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;

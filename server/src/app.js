const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const errorHandler = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use('/api/health', require('./modules/health/health.routes'));
app.use('/api/auth', require('./modules/auth/auth.routes'));
app.use('/api/handovers', require('./modules/handovers/handovers.routes'));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;

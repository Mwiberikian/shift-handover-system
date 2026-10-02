const AppError = require('../utils/AppError');

// Maps AppErrors and known Postgres errors to HTTP responses.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, ...(err.details && { details: err.details }) });
  }

  // Raised by the integrity triggers in the initial migration.
  if (err.code === 'P0001') {
    const status = ['record_locked', 'illegal_transition', 'append_only'].includes(err.hint) ? 409 : 400;
    return res.status(status).json({ error: err.message, code: err.hint });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'Duplicate value', detail: err.detail });
  if (err.code === '23503') return res.status(409).json({ error: 'Referenced row missing or in use', detail: err.detail });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid input syntax' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON body' });

  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = errorHandler;

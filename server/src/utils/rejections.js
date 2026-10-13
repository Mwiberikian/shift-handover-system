// DR-12: every rejected handover write is logged with its reason.
//
// Router-level error middleware. A 422 from submit or a 400 from validation
// has already rolled back the request's own transaction, so the audit row is
// written in a transaction of its own and survives. Only the reason is kept
// (field names, messages, missing template items), never the submitted values.
const AppError = require('./AppError');
const logger = require('./logger');
const { withTransaction } = require('../db/tx');
const { writeAudit } = require('./audit');

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRejection = (err, req) => err instanceof AppError
  && (err.status === 400 || err.status === 422)
  && WRITE_METHODS.has(req.method)
  && Boolean(req.user);

async function logRejectedWrite(err, req, res, next) {
  if (!isRejection(err, req)) return next(err);

  // Route params are gone by the time router-level error middleware runs, so
  // the record id is read from the path ('/:id/...').
  const segments = req.path.split('/');
  const recordId = UUID.test(segments[1] || '') ? segments[1] : null;
  const route = segments.map((s, i) => (UUID.test(s) ? (i === 1 ? ':id' : ':childId') : s)).join('/');
  const reason = {
    operation: `${req.method} ${req.baseUrl}${route}`,
    record_id: recordId,
    status: err.status,
    message: err.message,
    ...(err.details && { details: err.details }),
  };
  try {
    await withTransaction((client) => writeAudit(client, {
      userId: req.user.user_id,
      // A rejected create has no record yet, so it is filed against the user.
      entityType: recordId ? 'handover_record' : 'app_user',
      entityId: recordId || req.user.user_id,
      action: 'submit_rejected',
      newValue: reason,
    }));
  } catch (auditErr) {
    // Never turn a 400/422 into a 500 because the log write failed.
    logger.warn(`[rejected] audit write failed: ${auditErr.message}`);
  }
  const fields = Array.isArray(err.details) ? err.details.map((d) => d.field)
    : (err.details?.missing_fields || []).map((m) => m.field);
  logger.warn(`[rejected] ${err.status} ${reason.operation} user=${req.user.user_id} record=${recordId ?? '-'} `
    + `reason="${err.message}"${fields.length ? ` fields=${fields.join(',')}` : ''}`);
  return next(err);
}

module.exports = { logRejectedWrite };

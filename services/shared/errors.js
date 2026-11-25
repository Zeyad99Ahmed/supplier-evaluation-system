// Shared error type and Express error handling.
// Every error leaves the API in the same shape: { error: { code, message, details? } }
// (the format used since Lab 4).

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

const badRequest = (message, details) => new AppError(400, 'VALIDATION_ERROR', message, details);
const unauthorized = (message = 'Authentication is required.') => new AppError(401, 'UNAUTHENTICATED', message);
const forbidden = (message = 'You do not have permission to perform this action.') => new AppError(403, 'FORBIDDEN', message);
const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const conflict = (code, message) => new AppError(409, code, message);
const unprocessable = (code, message, details) => new AppError(422, code, message, details);

function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.' } });
}

// Express recognises an error handler by its four arguments.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const { logger } = require('./logger');
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON.' } });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } });
  }
  if (err instanceof AppError) {
    const body = { error: { code: err.code, message: err.message } };
    if (err.details) body.error.details = err.details;
    return res.status(err.status).json(body);
  }
  // Postgres constraint violations that slipped past validation
  if (err.code === '23505') {
    return res.status(409).json({ error: { code: 'DUPLICATE', message: 'A record with these values already exists.' } });
  }
  if (err.code === '23514' || err.code === '22P02' || err.code === '23503') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'The data breaks a database rule.' } });
  }
  // Unknown error: log the technical detail (never the request body), answer a generic 500.
  logger.error('unhandled_error', { reqId: req.reqId, path: req.path, errName: err.name, errMessage: err.message, pgCode: err.code });
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected server error occurred.' } });
}

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable, notFoundHandler, errorHandler };

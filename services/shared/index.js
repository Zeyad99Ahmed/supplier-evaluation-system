// Shared library used by all services (auth middleware, logging, errors, validation, DB, service calls).
// It is copied into each service's Lambda zip by scripts/package-lambda.js.
module.exports = {
  ...require('./errors'),
  ...require('./logger'),
  ...require('./auth'),
  ...require('./validate'),
  ...require('./config'),
  ...require('./createApp'),
  ...require('./serviceClient'),
  db: require('./db'),
};

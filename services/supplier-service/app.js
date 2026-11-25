// supplier-service: builds the Express app (no app.listen), used by server.js (PC) and lambda.js (AWS Lambda).
const { createApp } = require('../shared');

module.exports = createApp({
  serviceName: 'supplier-service',
  publicRouter: require('./src/routes'),
  internalRouter: require('./src/internalRoutes'),
});

// AWS Lambda entry point for evaluation-service (handler = evaluation-service/lambda.handler), as in Lab 7.
// serverless-http turns the API Gateway / Invoke event into an Express request and back.
// Secrets (DATABASE_URL, JWT secrets, API keys) are loaded from Secrets Manager once per cold start.
const serverless = require('serverless-http');
const { loadSecrets } = require('../shared');
const app = require('./app');

const handle = serverless(app);
let ready;

module.exports.handler = async (event, context) => {
  ready = ready || loadSecrets().catch((e) => { ready = undefined; throw e; }); // retry on next call if it failed
  await ready;
  return handle(event, context);
};

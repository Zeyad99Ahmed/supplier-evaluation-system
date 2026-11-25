// Network calls between services.
//
// SERVICE_TRANSPORT=http   (local): plain HTTP to <TARGET>_URL, e.g. ORDER_SERVICE_URL=http://localhost:4003
// SERVICE_TRANSPORT=lambda (Floci/AWS): lambda:InvokeFunction on <TARGET>_FUNCTION with an API Gateway v2
//   style event. Internal routes are NOT published on API Gateway, so they cannot be reached from the
//   internet at all; the caller's IAM role may invoke only the specific functions it needs.
//
// Both transports send a 60s service token (x-service-token) and time out after SERVICE_TIMEOUT_MS.

const { signServiceToken } = require('./auth');
const { AppError } = require('./errors');
const { logger } = require('./logger');

const envKey = (target) => target.toUpperCase().replace(/-/g, '_'); // order-service -> ORDER_SERVICE

async function callService(target, method, path, { body, actingUserId } = {}) {
  const transport = process.env.SERVICE_TRANSPORT || 'http';
  const timeoutMs = Number(process.env.SERVICE_TIMEOUT_MS || 6000);
  const headers = {
    'content-type': 'application/json',
    'x-service-token': signServiceToken(target),
    ...(actingUserId ? { 'x-acting-user': actingUserId } : {}),
  };
  const started = Date.now();
  try {
    let result;
    if (transport === 'lambda') result = await viaLambda(target, method, path, headers, body, timeoutMs);
    else result = await viaHttp(target, method, path, headers, body, timeoutMs);
    logger.info('service_call', { target, method, path: path.split('?')[0], status: result.status, ms: Date.now() - started });
    return result;
  } catch (e) {
    logger.error('SERVICE_CALL_FAILED', { target, method, path: path.split('?')[0], reason: e.message, ms: Date.now() - started });
    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `The ${target} is not reachable right now. Please try again.`);
  }
}

async function viaHttp(target, method, path, headers, body, timeoutMs) {
  const base = process.env[`${envKey(target)}_URL`];
  if (!base) throw new Error(`${envKey(target)}_URL not configured`);
  const res = await fetch(base.replace(/\/$/, '') + path, {
    method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

let lambdaClient;
async function viaLambda(target, method, path, headers, body, timeoutMs) {
  const fn = process.env[`${envKey(target)}_FUNCTION`];
  if (!fn) throw new Error(`${envKey(target)}_FUNCTION not configured`);
  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
  lambdaClient = lambdaClient || new LambdaClient({});
  const [rawPath, rawQueryString = ''] = path.split('?');
  const event = {
    version: '2.0', routeKey: '$default', rawPath, rawQueryString, headers,
    requestContext: { http: { method, path: rawPath, sourceIp: '127.0.0.1' }, requestId: `svc-${Date.now()}` },
    isBase64Encoded: false,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };
  const out = await lambdaClient.send(
    new InvokeCommand({ FunctionName: fn, Payload: Buffer.from(JSON.stringify(event)) }),
    { abortSignal: AbortSignal.timeout(timeoutMs) }
  );
  if (out.FunctionError) throw new Error(`function error: ${out.FunctionError}`);
  const payload = JSON.parse(Buffer.from(out.Payload).toString('utf8'));
  const raw = payload.isBase64Encoded ? Buffer.from(payload.body || '', 'base64').toString('utf8') : payload.body;
  return { status: payload.statusCode, body: raw ? JSON.parse(raw) : null };
}

module.exports = { callService };

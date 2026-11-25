// Structured JSON logging.
// On Lambda, stdout goes to CloudWatch Logs (/aws/lambda/<function>). One JSON object per line
// lets CloudWatch metric filters match fields, e.g. { $.event = "AUTH_LOGIN_FAILED" }.
// Locally, LOG_FILE also appends the same lines to a file so the log query script can read them.
// Rule: never log request bodies, passwords, tokens, secrets or rating comments.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SERVICE = () => process.env.SERVICE_NAME || 'unknown-service';

function write(level, event, fields = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, service: SERVICE(), event, ...fields });
  // process.stdout.write (not console.log): the Lambda Node.js runtime prefixes console.log lines with
  // "timestamp  requestId  INFO", which stops CloudWatch JSON metric filters from matching. Raw stdout
  // lines are stored unchanged, so every log event is pure JSON.
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  if (process.env.LOG_FILE) {
    try {
      fs.mkdirSync(path.dirname(process.env.LOG_FILE), { recursive: true });
      fs.appendFileSync(process.env.LOG_FILE, line + '\n');
    } catch (_) { /* logging must never break a request */ }
  }
}

const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};

// Security events go to the log AND to audit.activity_log (insert-only for service roles),
// so the Admin monitoring page can count them. The DB write is best-effort.
function securityEvent(eventType, { req, userId, statusCode, detail } = {}) {
  const fields = {
    reqId: req && req.reqId,
    method: req && req.method,
    path: req && (req.baseUrl || '') + (req.path || ''),
    userId: userId || (req && req.user && req.user.id) || null,
    status: statusCode,
    ip: req && clientIp(req),
    ...(detail ? { detail } : {}),
  };
  write('warn', eventType, fields);
  try {
    const db = require('./db');
    if (db.isConfigured()) {
      db.query(
        'INSERT INTO audit.activity_log (event_type, service, user_id, path, status_code, ip, detail) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [eventType, SERVICE(), fields.userId, fields.path || null, statusCode || null, fields.ip || null, detail ? JSON.stringify(detail) : null]
      ).catch((e) => write('error', 'AUDIT_WRITE_FAILED', { reason: e.message }));
    }
  } catch (_) { /* ignore */ }
}

function clientIp(req) {
  // API Gateway puts the caller address in the event; serverless-http exposes it as req.ip / x-forwarded-for.
  const fwd = req.headers && req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.ip) || null;
}

// One log line per request: time, method, path, status, duration, user id and role. No body, no headers.
function requestLogger(req, res, next) {
  req.reqId = crypto.randomUUID();
  const start = process.hrtime.bigint();
  res.setHeader('X-Request-Id', req.reqId);
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    write(res.statusCode >= 500 ? 'error' : 'info', 'http_request', {
      reqId: req.reqId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      userId: req.user ? req.user.id : null,
      role: req.user ? req.user.role : (req.caller ? 'service:' + req.caller : null),
    });
  });
  next();
}

module.exports = { logger, securityEvent, requestLogger, clientIp };

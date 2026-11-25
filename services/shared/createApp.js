// Builds the Express app for one service with the shared security middleware.
// The same app runs locally (server.js -> app.listen) and on AWS Lambda (lambda.js -> serverless-http),
// exactly like Lab 7.

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { requestLogger } = require('./logger');
const { requireJson } = require('./validate');
const { notFoundHandler, errorHandler } = require('./errors');
const db = require('./db');

function createApp({ serviceName, publicRouter, internalRouter }) {
  process.env.SERVICE_NAME = process.env.SERVICE_NAME || serviceName;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // Security headers (HSTS, no-sniff, frame-deny, a strict CSP for any HTML the API might return).
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));

  // CORS: only the configured website origin(s) may call the API from a browser.
  const origins = (process.env.CORS_ORIGINS || 'http://localhost:8080').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin(origin, cb) { cb(null, !origin || origins.includes(origin)); },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));

  app.use(requestLogger);
  app.use(express.json({ limit: '50kb' }));
  app.use(requireJson);

  app.get('/api/health', async (req, res) => {
    let database = 'not-configured';
    if (db.isConfigured()) {
      try { await db.ping(); database = 'ok'; } catch (_) { database = 'unreachable'; }
    }
    res.status(database === 'unreachable' ? 503 : 200).json({
      status: database === 'unreachable' ? 'degraded' : 'ok',
      service: process.env.SERVICE_NAME,
      runtime: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'lambda' : 'pc',
      environment: process.env.NODE_ENV || 'development',
      database,
    });
  });

  if (publicRouter) app.use('/api', publicRouter);
  if (internalRouter) app.use('/internal', internalRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// Wraps async route handlers so rejected promises reach the error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { createApp, ah };

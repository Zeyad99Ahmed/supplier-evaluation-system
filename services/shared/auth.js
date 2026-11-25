// Authentication & authorization middleware shared by every service.
//
// User tokens: the Auth Service signs a short-lived JWT (HS256) after login. Every service verifies the
// signature, issuer, audience and expiry locally with JWT_SECRET (from Secrets Manager), so services
// stay independently deployable. The role comes ONLY from the signed token, never from the request body.
//
// Service tokens: when one service calls another (e.g. Order -> Evaluation for currency conversion) it
// signs a 60-second token with a DIFFERENT secret (INTERNAL_JWT_SECRET) whose audience is the target
// service. /internal routes accept only these tokens and only from an allow-list of caller services.

const jwt = require('jsonwebtoken');
const { unauthorized, forbidden } = require('./errors');
const { securityEvent } = require('./logger');

const ISSUER = 'ses-auth-service';
const USER_AUDIENCE = 'ses-app';

function signUserToken(user, sessionId, hours) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.full_name, sid: sessionId },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', issuer: ISSUER, audience: USER_AUDIENCE, expiresIn: `${hours}h` }
  );
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    securityEvent('AUTH_MISSING_TOKEN', { req, statusCode: 401 });
    return next(unauthorized());
  }
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: ISSUER, audience: USER_AUDIENCE });
    if (!['admin', 'staff'].includes(claims.role)) throw new Error('bad role');
    req.user = { id: claims.sub, role: claims.role, email: claims.email, name: claims.name, sid: claims.sid };
    return next();
  } catch (e) {
    securityEvent('AUTH_INVALID_TOKEN', { req, statusCode: 401, detail: { reason: e.name } });
    return next(unauthorized('Your session is invalid or has expired. Please log in again.'));
  }
}

// requireRole('admin') -> only admins; requireRole('staff') -> only staff; requireRole('admin','staff') -> both
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      securityEvent('ACCESS_DENIED_ROLE', { req, statusCode: 403, detail: { role: req.user.role, needed: roles } });
      return next(forbidden());
    }
    return next();
  };
}

// ---- service-to-service ----
function signServiceToken(targetService) {
  return jwt.sign({ sub: process.env.SERVICE_NAME }, process.env.INTERNAL_JWT_SECRET, {
    algorithm: 'HS256', issuer: 'ses-internal', audience: targetService, expiresIn: '60s',
  });
}

function internalOnly(allowedCallers) {
  return (req, res, next) => {
    const token = (req.headers['x-service-token'] || '').trim();
    try {
      if (!token) throw new Error('missing');
      const claims = jwt.verify(token, process.env.INTERNAL_JWT_SECRET, {
        algorithms: ['HS256'], issuer: 'ses-internal', audience: process.env.SERVICE_NAME,
      });
      if (!allowedCallers.includes(claims.sub)) {
        securityEvent('INTERNAL_CALLER_DENIED', { req, statusCode: 403, detail: { caller: claims.sub } });
        return next(forbidden('This service may not call this internal route.'));
      }
      req.caller = claims.sub;
      // The acting user (if any) is passed for audit only; it is NOT used for authorization here.
      req.actingUserId = req.headers['x-acting-user'] || null;
      return next();
    } catch (e) {
      securityEvent('INTERNAL_TOKEN_INVALID', { req, statusCode: 401, detail: { reason: e.message } });
      return next(unauthorized('A valid service token is required.'));
    }
  };
}

module.exports = { authenticate, requireRole, signUserToken, signServiceToken, internalOnly, ISSUER, USER_AUDIENCE };

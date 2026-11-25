// Small, explicit validation helpers (the same style as the Lab 4 controllers, but reusable).
// A validator collects every problem and throws one 400 with a details list, so the frontend can
// show all messages at once.

const { badRequest, AppError } = require('./errors');

// Currencies the system accepts (allow-list). The ExchangeRate API supports all of them.
const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'CNY', 'JPY', 'CHF', 'CAD', 'TRY', 'KWD'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

// 415 for anything that is not JSON on write routes (POST/PUT/PATCH).
function requireJson(req, res, next) {
  const hasBody = req.headers['transfer-encoding'] !== undefined || (req.headers['content-length'] && req.headers['content-length'] !== '0');
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && hasBody && !req.is('application/json')) {
    return next(new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json.'));
  }
  return next();
}

class Validator {
  constructor(source) { this.src = source || {}; this.errors = []; this.out = {}; }

  _get(field) { return this.src[field]; }
  _missing(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }
  fail(field, message) { this.errors.push({ field, message }); return this; }

  string(field, { required = false, min = 0, max = 200, pattern, patternMsg } = {}) {
    const v = this._get(field);
    if (this._missing(v)) { if (required) this.fail(field, `${field} is required.`); return this; }
    if (typeof v !== 'string') return this.fail(field, `${field} must be text.`);
    const t = v.trim();
    if (t.length < min) return this.fail(field, `${field} must be at least ${min} characters.`);
    if (t.length > max) return this.fail(field, `${field} must be at most ${max} characters.`);
    if (pattern && !pattern.test(t)) return this.fail(field, patternMsg || `${field} has an invalid format.`);
    this.out[field] = t;
    return this;
  }

  email(field, opts = {}) { return this.string(field, { max: 120, ...opts, pattern: EMAIL_RE, patternMsg: `${field} must be a valid e-mail address.` }); }
  phone(field, opts = {}) { return this.string(field, { max: 20, ...opts, pattern: PHONE_RE, patternMsg: `${field} must be a valid phone number.` }); }

  number(field, { required = false, min, max, integer = false } = {}) {
    const v = this._get(field);
    if (this._missing(v)) { if (required) this.fail(field, `${field} is required.`); return this; }
    const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
    if (!Number.isFinite(n)) return this.fail(field, `${field} must be a number.`);
    if (integer && !Number.isInteger(n)) return this.fail(field, `${field} must be a whole number.`);
    if (min !== undefined && n < min) return this.fail(field, `${field} must be at least ${min}.`);
    if (max !== undefined && n > max) return this.fail(field, `${field} must be at most ${max}.`);
    this.out[field] = n;
    return this;
  }

  oneOf(field, values, { required = false } = {}) {
    const v = this._get(field);
    if (this._missing(v)) { if (required) this.fail(field, `${field} is required.`); return this; }
    if (!values.includes(v)) return this.fail(field, `${field} must be one of: ${values.join(', ')}.`);
    this.out[field] = v;
    return this;
  }

  currency(field, opts = {}) {
    const v = this._get(field);
    if (typeof v === 'string') this.src = { ...this.src, [field]: v.trim().toUpperCase() };
    return this.oneOf(field, CURRENCIES, opts);
  }

  uuid(field, { required = false } = {}) {
    const v = this._get(field);
    if (this._missing(v)) { if (required) this.fail(field, `${field} is required.`); return this; }
    if (typeof v !== 'string' || !UUID_RE.test(v)) return this.fail(field, `${field} must be a valid id.`);
    this.out[field] = v.toLowerCase();
    return this;
  }

  date(field, { required = false, notFuture = false } = {}) {
    const v = this._get(field);
    if (this._missing(v)) { if (required) this.fail(field, `${field} is required.`); return this; }
    if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(Date.parse(v + 'T00:00:00Z'))) {
      return this.fail(field, `${field} must be a date in YYYY-MM-DD format.`);
    }
    if (notFuture && v > today()) return this.fail(field, `${field} cannot be in the future.`);
    this.out[field] = v;
    return this;
  }

  // Reject fields the client must never set (e.g. role, createdBy, status on create).
  forbid(...fields) {
    for (const f of fields) if (this.src[f] !== undefined) this.fail(f, `${f} cannot be set by the client.`);
    return this;
  }

  check(condition, field, message) { if (!condition) this.fail(field, message); return this; }

  done() {
    if (this.errors.length) throw badRequest('Some fields are invalid.', this.errors);
    return this.out;
  }
}

const validate = (src) => new Validator(src);

function assertUuid(id, what = 'Resource') {
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    // Malformed ids are treated like unknown ids (404), so ids cannot be probed for format.
    throw new AppError(404, 'NOT_FOUND', `${what} not found.`);
  }
  return id.toLowerCase();
}

function today() { return new Date().toISOString().slice(0, 10); }

function pagination(q) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  return { limit, offset: (page - 1) * limit, page };
}

module.exports = { validate, requireJson, assertUuid, today, pagination, CURRENCIES, UUID_RE };

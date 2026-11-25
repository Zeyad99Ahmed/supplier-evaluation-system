// Auth Service (shared component, lead: Zeyad).
// Login / logout / me, Admin-managed Staff accounts, account lock-out after repeated failures,
// and the Admin security-monitoring view over audit.activity_log.

const {
  db, validate, assertUuid, signUserToken, securityEvent, logger,
  AppError, unauthorized, notFound, conflict, badRequest,
} = require('../../shared');
const { hashPassword, verifyPassword, dummyVerify, passwordProblems } = require('./passwords');

const MAX_FAILED = () => Number(process.env.LOGIN_MAX_FAILED || 5);
const LOCK_MINUTES = () => Number(process.env.LOGIN_LOCK_MINUTES || 15);
const SESSION_HOURS = () => Number(process.env.SESSION_HOURS || 2);

const publicUser = (u) => ({
  id: u.id, email: u.email, fullName: u.full_name, role: u.role, isActive: u.is_active,
  createdAt: u.created_at, lastLoginAt: u.last_login_at,
});

// POST /api/auth/login
async function login(req, res) {
  const { email, password } = validate(req.body)
    .email('email', { required: true })
    .string('password', { required: true, max: 72 })
    .done();

  const { rows } = await db.query('SELECT * FROM auth.users WHERE lower(email) = lower($1)', [email]);
  const user = rows[0];

  if (!user) {
    await dummyVerify(password);
    securityEvent('AUTH_LOGIN_FAILED', { req, statusCode: 401, detail: { reason: 'unknown_email' } });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail or password is incorrect.');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    securityEvent('AUTH_LOGIN_LOCKED', { req, userId: user.id, statusCode: 429 });
    throw new AppError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again after ${LOCK_MINUTES()} minutes.`);
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok || !user.is_active) {
    if (!ok) {
      const failed = user.failed_attempts + 1;
      const lock = failed >= MAX_FAILED();
      await db.query(
        `UPDATE auth.users SET failed_attempts = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE locked_until END WHERE id = $1`,
        [user.id, lock ? 0 : failed, lock, LOCK_MINUTES()]
      );
      securityEvent(lock ? 'AUTH_ACCOUNT_LOCKED' : 'AUTH_LOGIN_FAILED', { req, userId: user.id, statusCode: 401, detail: { reason: 'wrong_password', attempt: failed } });
    } else {
      securityEvent('AUTH_LOGIN_FAILED', { req, userId: user.id, statusCode: 401, detail: { reason: 'account_disabled' } });
    }
    // Same message for every failure so attackers cannot tell which e-mails exist.
    throw new AppError(401, 'INVALID_CREDENTIALS', 'E-mail or password is incorrect.');
  }

  const { rows: s } = await db.query(
    `INSERT INTO auth.sessions (user_id, expires_at) VALUES ($1, now() + make_interval(hours => $2)) RETURNING id, expires_at`,
    [user.id, SESSION_HOURS()]
  );
  await db.query('UPDATE auth.users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  const token = signUserToken(user, s[0].id, SESSION_HOURS());
  logger.info('AUTH_LOGIN_SUCCESS', { reqId: req.reqId, userId: user.id, role: user.role });
  res.status(200).json({ token, expiresAt: s[0].expires_at, user: publicUser(user) });
}

// POST /api/auth/logout  - revokes the server-side session
async function logout(req, res) {
  await db.query('UPDATE auth.sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL', [req.user.sid, req.user.id]);
  logger.info('AUTH_LOGOUT', { reqId: req.reqId, userId: req.user.id });
  res.status(200).json({ message: 'Logged out.' });
}

// GET /api/auth/me - also checks the session is still live (not revoked, not expired, account active)
async function me(req, res) {
  const { rows } = await db.query(
    `SELECT u.* FROM auth.sessions s JOIN auth.users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.is_active`,
    [req.user.sid, req.user.id]
  );
  if (!rows[0]) {
    securityEvent('AUTH_SESSION_INVALID', { req, statusCode: 401 });
    throw unauthorized('Your session has ended. Please log in again.');
  }
  res.status(200).json({ user: publicUser(rows[0]) });
}

// POST /api/users (Admin) - create a Staff account. There is no public sign-up.
async function createUser(req, res) {
  const body = validate(req.body)
    .email('email', { required: true })
    .string('fullName', { required: true, min: 2, max: 100 })
    .string('password', { required: true, max: 72 })
    .forbid('role', 'isActive', 'id')
    .done();
  const problem = passwordProblems(body.password);
  if (problem) throw badRequest('Some fields are invalid.', [{ field: 'password', message: problem }]);

  const exists = await db.query('SELECT 1 FROM auth.users WHERE lower(email) = lower($1)', [body.email]);
  if (exists.rowCount) throw conflict('EMAIL_TAKEN', 'An account with this e-mail already exists.');

  const hash = await hashPassword(body.password);
  const { rows } = await db.query(
    `INSERT INTO auth.users (email, password_hash, full_name, role, created_by) VALUES ($1,$2,$3,'staff',$4) RETURNING *`,
    [body.email.toLowerCase(), hash, body.fullName, req.user.id]
  );
  securityEvent('ACCOUNT_CREATED', { req, statusCode: 201, detail: { newUserId: rows[0].id, role: 'staff' } });
  res.status(201).json({ user: publicUser(rows[0]) });
}

// GET /api/users (Admin) - list / search accounts
async function listUsers(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 60) : '';
  const role = ['admin', 'staff'].includes(req.query.role) ? req.query.role : null;
  const { rows } = await db.query(
    `SELECT * FROM auth.users
      WHERE ($1 = '' OR full_name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR role = $2)
      ORDER BY created_at DESC LIMIT 200`,
    [search, role]
  );
  res.status(200).json({ users: rows.map(publicUser) });
}

// PATCH /api/users/:id/status (Admin) - enable/disable an account; disabling revokes its sessions.
async function setUserStatus(req, res) {
  const id = assertUuid(req.params.id, 'User');
  const { isActive } = req.body || {};
  if (typeof isActive !== 'boolean') throw badRequest('Some fields are invalid.', [{ field: 'isActive', message: 'isActive must be true or false.' }]);
  if (id === req.user.id && !isActive) throw new AppError(409, 'CANNOT_DISABLE_SELF', 'An Admin cannot disable their own account.');
  const { rows } = await db.query('UPDATE auth.users SET is_active = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING *', [id, isActive]);
  if (!rows[0]) throw notFound('User');
  if (!isActive) await db.query('UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
  securityEvent(isActive ? 'ACCOUNT_ENABLED' : 'ACCOUNT_DISABLED', { req, statusCode: 200, detail: { targetUserId: id } });
  res.status(200).json({ user: publicUser(rows[0]) });
}

// GET /api/admin/activity?days=7 (Admin) - monitoring: security events per day and suspicious patterns
async function activity(req, res) {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 90);
  const perDay = await db.query(
    `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, event_type, count(*)::int AS count
       FROM audit.activity_log WHERE created_at > now() - make_interval(days => $1)
      GROUP BY 1, 2 ORDER BY 1 DESC, 3 DESC`, [days]);
  const totals = await db.query(
    `SELECT event_type, count(*)::int AS count, max(created_at) AS last_seen
       FROM audit.activity_log WHERE created_at > now() - make_interval(days => $1)
      GROUP BY 1 ORDER BY 2 DESC`, [days]);
  // Alert-style rule: 5+ failed logins (or 403s) from one source within 15 minutes.
  const suspicious = await db.query(
    `SELECT coalesce(ip, 'unknown') AS source, event_type, count(*)::int AS count, min(created_at) AS first_seen, max(created_at) AS last_seen
       FROM audit.activity_log
      WHERE created_at > now() - interval '15 minutes'
        AND event_type IN ('AUTH_LOGIN_FAILED', 'AUTH_ACCOUNT_LOCKED', 'ACCESS_DENIED_ROLE', 'ACCESS_DENIED_OWNERSHIP')
      GROUP BY 1, 2 HAVING count(*) >= 5 ORDER BY 3 DESC`);
  const recent = await db.query(
    `SELECT created_at, event_type, service, path, status_code, user_id FROM audit.activity_log
      ORDER BY id DESC LIMIT 25`);
  res.status(200).json({ days, totals: totals.rows, perDay: perDay.rows, suspicious: suspicious.rows, recent: recent.rows });
}

module.exports = { login, logout, me, createUser, listUsers, setUserStatus, activity };

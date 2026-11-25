// Shared fetch helper (proposal 5.2): adds the session token, sends/receives JSON, and turns the API's
// { error: { code, message, details } } shape into a readable Error. On 401 the user is sent to login.
(function () {
  const cfg = window.SES_CONFIG;
  const BASES = { auth: cfg.AUTH_API, supplier: cfg.SUPPLIER_API, order: cfg.ORDER_API, evaluation: cfg.EVALUATION_API };

  class ApiError extends Error {
    constructor(status, body) {
      const err = (body && body.error) || {};
      super(err.message || `Request failed (${status}).`);
      this.status = status; this.code = err.code; this.details = err.details || [];
    }
  }

  async function request(service, method, path, body) {
    const headers = { Accept: 'application/json' };
    const token = sessionStorage.getItem('ses_token');
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(BASES[service] + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) {
      throw new ApiError(0, { error: { message: 'Cannot reach the ' + service + ' service. Check that it is running.' } });
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
    if (res.status === 401 && path !== '/api/auth/login') {
      sessionStorage.removeItem('ses_token'); sessionStorage.removeItem('ses_user');
      if (!location.pathname.endsWith('index.html') && location.pathname !== '/') location.href = 'index.html?expired=1';
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  const qs = (params) => {
    const p = new URLSearchParams();
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
    const s = p.toString();
    return s ? '?' + s : '';
  };

  window.api = {
    ApiError, qs, request,
    get: (svc, path) => request(svc, 'GET', path),
    post: (svc, path, body) => request(svc, 'POST', path, body === undefined ? {} : body),
    put: (svc, path, body) => request(svc, 'PUT', path, body),
    patch: (svc, path, body) => request(svc, 'PATCH', path, body),
    del: (svc, path) => request(svc, 'DELETE', path),
  };
})();

// Login page (shared auth - Zeyad). POST /api/auth/login -> JWT kept in sessionStorage (cleared when the tab closes).
(function () {
  const { formData, showError, clearError } = window.ui;
  const form = document.getElementById('login-form');
  const errBox = document.getElementById('login-error');

  if (ui.params().get('expired')) {
    const n = document.getElementById('notice'); n.hidden = false; n.textContent = 'Your session ended. Please sign in again.';
  }
  if (sessionStorage.getItem('ses_token')) location.href = 'dashboard.html';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError(errBox);
    const body = formData(form);
    if (!body.email || !body.password) return showError(errBox, { message: 'Enter your e-mail and password.' });
    const btn = document.getElementById('login-btn');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const res = await api.post('auth', '/api/auth/login', body);
      sessionStorage.setItem('ses_token', res.token);
      sessionStorage.setItem('ses_user', JSON.stringify(res.user));
      location.href = 'dashboard.html';
    } catch (err) {
      showError(errBox, err);
      form.password.value = '';
    } finally {
      btn.disabled = false; btn.textContent = 'Sign in';
    }
  });

  // Show which backend services are reachable (GET /api/health on each).
  (async () => {
    const names = { auth: 'Auth', supplier: 'Supplier', order: 'Order', evaluation: 'Evaluation' };
    const parts = await Promise.all(Object.keys(names).map(async (k) => {
      try { const h = await api.get(k, '/api/health'); return `${names[k]}: ${h.status} (${h.runtime})`; } catch (_) { return `${names[k]}: offline`; }
    }));
    document.getElementById('api-status').textContent = parts.join(' · ');
  })();
})();

// Shared session + navigation (lead: Zeyad). Every page except login calls requireLogin(), which also
// asks the Auth Service (/api/auth/me) whether the session is still valid. The navigation hides links a
// role cannot use, but that is only for convenience: every action is enforced again in the backend.
(function () {
  const { el } = window.ui;

  const getUser = () => { try { return JSON.parse(sessionStorage.getItem('ses_user')); } catch (_) { return null; } };

  async function requireLogin(roles) {
    const user = getUser();
    if (!sessionStorage.getItem('ses_token') || !user) { location.href = 'index.html'; return null; }
    try {
      const me = await api.get('auth', '/api/auth/me');
      sessionStorage.setItem('ses_user', JSON.stringify(me.user));
    } catch (e) { location.href = 'index.html?expired=1'; return null; }
    const fresh = getUser();
    renderNav(fresh);
    if (roles && !roles.includes(fresh.role)) {
      document.querySelector('main').replaceChildren(el('div', { class: 'card' }, el('h2', { text: 'Not allowed' }), el('p', { text: 'Your role cannot open this page.' })));
      return null;
    }
    document.body.dataset.role = fresh.role;
    return fresh;
  }

  function renderNav(user) {
    const links = [
      ['dashboard.html', 'Dashboard'],
      ['suppliers.html', 'Suppliers'],
      ['orders.html', 'Orders'],
      ['evaluations.html', 'Evaluations'],
    ];
    if (user.role === 'admin') links.push(['admin.html', 'Admin & Security']);
    const here = location.pathname.split('/').pop() || 'dashboard.html';
    const nav = el('nav', { class: 'topnav', 'aria-label': 'Main' },
      el('a', { class: 'brand', href: 'dashboard.html' }, el('span', { class: 'logo', 'aria-hidden': 'true', text: 'SD' }), 'Supplier Directory & Evaluation'),
      el('div', { class: 'links' }, links.map(([href, label]) => el('a', { href, class: here === href || (here === 'supplier.html' && href === 'suppliers.html') ? 'active' : '' , text: label }))),
      el('div', { class: 'who' },
        el('span', { class: 'user', text: user.fullName }), ' ', window.ui.badge(user.role),
        el('button', { class: 'btn-link', type: 'button', onclick: logout, text: 'Log out' })));
    document.getElementById('nav').replaceChildren(nav);
  }

  async function logout() {
    try { await api.post('auth', '/api/auth/logout'); } catch (_) { /* session may already be gone */ }
    sessionStorage.clear();
    location.href = 'index.html';
  }

  window.auth = { requireLogin, getUser, logout };
})();

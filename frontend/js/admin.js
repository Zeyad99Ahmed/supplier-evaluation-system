// Admin page - shared Auth & logging (lead: Zeyad). Staff accounts + security monitoring.
(async function () {
  const { el, badge, dateTime, table, formData, showError, clearError, toast } = window.ui;
  const user = await auth.requireLogin(['admin']);
  if (!user) return;

  async function loadUsers() {
    const res = await api.get('auth', '/api/users');
    document.getElementById('users').replaceChildren(table(['Name', 'E-mail', 'Role', 'Status', 'Last login', 'Created', ''],
      res.users.map((u) => el('tr', {},
        el('td', { text: u.fullName }), el('td', { text: u.email }), el('td', {}, badge(u.role)),
        el('td', {}, badge(u.isActive ? 'ACTIVE' : 'SUSPENDED')), el('td', { class: 'small', text: dateTime(u.lastLoginAt) }), el('td', { class: 'small', text: dateTime(u.createdAt) }),
        el('td', {}, u.id === user.id ? el('span', { class: 'muted small', text: 'you' }) :
          el('button', { class: 'small ' + (u.isActive ? 'danger' : 'secondary'), type: 'button', onclick: () => toggle(u), text: u.isActive ? 'Disable' : 'Enable' }))))));
  }

  async function toggle(u) {
    if (!confirm(`${u.isActive ? 'Disable' : 'Enable'} ${u.fullName}?${u.isActive ? ' Their sessions are revoked.' : ''}`)) return;
    try { await api.patch('auth', `/api/users/${u.id}/status`, { isActive: !u.isActive }); toast('Account updated.'); loadUsers(); loadActivity(); } catch (e) { toast(e.message, 'err'); }
  }

  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('user-error');
    clearError(errBox);
    try {
      const res = await api.post('auth', '/api/users', formData(e.target));
      toast(`Staff account created for ${res.user.fullName}.`); e.target.reset(); loadUsers(); loadActivity();
    } catch (err) { showError(errBox, err); }
  });

  async function loadActivity() {
    const a = await api.get('auth', '/api/admin/activity?days=7');
    const count = (type) => (a.totals.find((t) => t.event_type === type) || { count: 0 }).count;
    const stat = (l, v, warn) => el('div', { class: 'stat' }, el('div', { class: 'label', text: l }), el('div', { class: 'value' + (warn ? ' warn' : ''), text: v }));
    document.getElementById('sec-stats').replaceChildren(
      stat('Failed logins (7d)', count('AUTH_LOGIN_FAILED')), stat('Accounts locked (7d)', count('AUTH_ACCOUNT_LOCKED')),
      stat('403 role denials (7d)', count('ACCESS_DENIED_ROLE')), stat('Ownership denials (7d)', count('ACCESS_DENIED_OWNERSHIP')),
      stat('Missing/invalid token (7d)', count('AUTH_MISSING_TOKEN') + count('AUTH_INVALID_TOKEN')), stat('Rate API failures (7d)', count('EXTERNAL_API_FAILURE')));
    document.getElementById('suspicious').replaceChildren(a.suspicious.length
      ? table(['Source', 'Event', 'Count', 'First', 'Last'], a.suspicious.map((s) => el('tr', {}, el('td', { text: s.source }), el('td', {}, badge(s.event_type)), el('td', { class: 'num', text: s.count }), el('td', { class: 'small', text: dateTime(s.first_seen) }), el('td', { class: 'small', text: dateTime(s.last_seen) }))))
      : el('p', { class: 'muted', text: 'No source crossed the alert threshold in the last 15 minutes.' }));
    document.getElementById('per-day').replaceChildren(table(['Day', 'Event', 'Count'], a.perDay.map((r) => el('tr', {}, el('td', { text: r.day }), el('td', { text: r.event_type }), el('td', { class: 'num', text: r.count }))), 'No security events recorded.'));
    document.getElementById('recent').replaceChildren(table(['When', 'Event', 'Service', 'Path', 'Code'], a.recent.map((r) => el('tr', {}, el('td', { class: 'small', text: dateTime(r.created_at) }), el('td', { class: 'small', text: r.event_type }), el('td', { class: 'small', text: r.service }), el('td', { class: 'small', text: r.path || '' }), el('td', { class: 'num', text: r.status_code || '' })))));
  }

  loadUsers(); loadActivity();
})();

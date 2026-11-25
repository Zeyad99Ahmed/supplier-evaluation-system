// Dashboard: one view that pulls data from all three services (integration point).
(async function () {
  const { el, money, score, badge, date, table } = window.ui;
  const user = await auth.requireLogin();
  if (!user) return;
  document.getElementById('welcome').textContent = `Signed in as ${user.fullName} (${user.role}). ` +
    (user.role === 'admin' ? 'You manage suppliers, contracts and approvals.' : 'You raise orders and rate suppliers after delivery.');

  const stat = (label, value) => el('div', { class: 'stat' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }));
  const safe = (p) => p.catch(() => null);
  const [allSup, activeSup, summary, ratings, recent, top] = await Promise.all([
    safe(api.get('supplier', '/api/suppliers?limit=1')),
    safe(api.get('supplier', '/api/suppliers?status=ACTIVE&limit=1')),
    safe(api.get('order', '/api/orders/summary')),
    safe(api.get('evaluation', '/api/evaluations?limit=1' + (user.role === 'staff' ? '&mine=true' : ''))),
    safe(api.get('order', '/api/orders?limit=6')),
    safe(api.get('supplier', '/api/suppliers?sort=score&limit=5')),
  ]);
  const t = summary ? summary.totals : null;
  document.getElementById('stats').replaceChildren(
    stat('Suppliers (active / all)', allSup ? `${activeSup ? activeSup.total : '?'} / ${allSup.total}` : '—'),
    stat(user.role === 'admin' ? 'Orders (all)' : 'My orders', t ? t.orders : '—'),
    stat('Spend (EGP)', t ? money(t.spendEgp) : '—'),
    stat('Waiting for approval', t ? t.pendingApproval : '—'),
    stat(user.role === 'admin' ? 'Ratings (all)' : 'My ratings', ratings ? ratings.total : '—'),
  );

  document.getElementById('recent-orders').replaceChildren(recent ? table(['PO', 'Supplier', 'EGP', 'Status', 'Date'],
    recent.orders.map((o) => el('tr', {}, el('td', {}, el('a', { href: 'orders.html?id=' + o.id, text: o.orderNumber })), el('td', { text: o.supplierName }),
      el('td', { class: 'num', text: money(o.amountEgp) }), el('td', {}, badge(o.status)), el('td', { text: date(o.orderDate) }))), 'No orders yet.') : el('p', { class: 'error-box', text: 'Order Service unavailable.' }));

  document.getElementById('top-suppliers').replaceChildren(top ? table(['Supplier', 'Category', 'Score', 'Ratings', 'Status'],
    top.suppliers.map((s) => el('tr', {}, el('td', {}, el('a', { href: 'supplier.html?id=' + s.id, text: s.name })), el('td', { text: s.category }),
      el('td', { class: 'num', text: score(s.performance.avgScore) }), el('td', { class: 'num', text: s.performance.ratingCount }), el('td', {}, badge(s.status)))), 'No suppliers yet.') : el('p', { class: 'error-box', text: 'Supplier Service unavailable.' }));
})();

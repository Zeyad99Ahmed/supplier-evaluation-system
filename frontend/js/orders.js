// Purchase orders page - Order Service frontend (owner: Ebraheem).
// F1 create (with a live EGP preview from the Evaluation Service), F2 list/filter, F3 details + history,
// F4 deliver/cancel, F5 approve/reject (admin), F6 spending summary, F7 retry conversion.
(async function () {
  const { el, badge, money, date, dateTime, table, formData, showError, clearError, toast, pager, fillCurrencies, todayIso } = window.ui;
  const user = await auth.requireLogin();
  if (!user) return;
  const isAdmin = user.role === 'admin';
  fillCurrencies();
  document.getElementById('scope-note').textContent = isAdmin ? 'Admin view: every order, approvals and spending.' : 'Your orders only. Ratings open once an order is delivered.';

  const orderForm = document.getElementById('order-form');
  orderForm.orderDate.value = todayIso();

  // Suppliers for the dropdowns come from the Supplier Service.
  async function loadSuppliers() {
    const active = await api.get('supplier', '/api/suppliers?status=ACTIVE&limit=100');
    const all = await api.get('supplier', '/api/suppliers?limit=100');
    document.getElementById('o-supplier').replaceChildren(el('option', { value: '', text: 'Choose an active supplier…' }),
      ...active.suppliers.map((s) => el('option', { value: s.id, text: `${s.name} (${s.category})${s.hasCurrentContract ? '' : ' - no current contract'}` })));
    document.getElementById('f-supplier').replaceChildren(el('option', { value: '', text: 'All suppliers' }), ...all.suppliers.map((s) => el('option', { value: s.id, text: s.name })));
    const pre = ui.params().get('supplierId');
    if (pre) orderForm.supplierId.value = pre;
  }

  // Live preview: total and EGP equivalent (GET /api/rates/convert on the Evaluation Service).
  let previewTimer;
  function preview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(async () => {
      const q = Number(orderForm.quantity.value); const p = Number(orderForm.unitPrice.value); const cur = orderForm.currency.value;
      const out = document.getElementById('egp-preview');
      if (!(q > 0 && p > 0)) { out.textContent = 'Total: —'; return; }
      const total = Math.round(q * p * 100) / 100;
      if (cur === 'EGP') { out.textContent = `Total: ${money(total, 'EGP')}`; return; }
      try {
        const r = await api.get('evaluation', '/api/rates/convert' + api.qs({ amount: total, currency: cur }));
        out.textContent = `Total: ${money(total, cur)} ≈ ${money(r.amountEgp, 'EGP')} (rate ${r.rateToEgp}, ${r.rateDate}${r.stale ? ', cached' : ''})`;
      } catch (e) { out.textContent = `Total: ${money(total, cur)} (EGP rate unavailable: ${e.message})`; }
    }, 350);
  }
  ['quantity', 'unitPrice', 'currency'].forEach((n) => orderForm[n].addEventListener('input', preview));

  orderForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('order-error');
    clearError(errBox);
    const f = formData(orderForm);
    try {
      const res = await api.post('order', '/api/orders', { ...f, quantity: f.quantity ? Number(f.quantity) : undefined, unitPrice: f.unitPrice ? Number(f.unitPrice) : undefined });
      const o = res.order;
      toast(`${o.orderNumber} created - ${o.status.replace('_', ' ')}${o.conversionStatus === 'PENDING' ? ' (EGP conversion pending)' : ''}.`);
      orderForm.reset(); fillCurrencies(); orderForm.orderDate.value = todayIso(); document.getElementById('egp-preview').textContent = 'Total: —';
      list(1); loadSummary(); showDetail(o.id);
    } catch (err) { showError(errBox, err); }
  });

  // ---- F2 list
  const filterForm = document.getElementById('filter-form');
  async function list(page = 1) {
    const errBox = document.getElementById('list-error');
    clearError(errBox);
    try {
      const res = await api.get('order', '/api/orders' + api.qs({ ...formData(filterForm), page, limit: 10 }));
      document.getElementById('order-list').replaceChildren(table(
        ['PO', 'Supplier', 'Item', 'Amount', 'EGP', 'Ordered', 'Expected', 'Status', isAdmin ? 'Raised by' : 'Delivery', 'Actions'],
        res.orders.map((o) => el('tr', {},
          el('td', {}, el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); showDetail(o.id); }, text: o.orderNumber })),
          el('td', { text: o.supplierName }), el('td', { text: `${o.description} × ${o.quantity}` }),
          el('td', { class: 'num', text: money(o.amount, o.currency) }),
          el('td', { class: 'num', text: o.conversionStatus === 'PENDING' ? 'pending' : money(o.amountEgp) }),
          el('td', { text: date(o.orderDate) }), el('td', { text: date(o.expectedDate) }), el('td', {}, badge(o.status)),
          el('td', { class: 'small', text: isAdmin ? (o.createdByName || '—') : (o.deliveredDate ? (o.onTime ? 'On time' : `${o.daysLate} day(s) late`) : '—') }),
          el('td', {}, actions(o)))),
        'No orders match these filters.'));
      pager(document.getElementById('pager'), res.page, res.limit, res.total, list);
    } catch (e) { showError(errBox, e); }
  }
  filterForm.addEventListener('submit', (e) => { e.preventDefault(); list(1); });
  filterForm.addEventListener('reset', () => setTimeout(() => list(1), 0));

  function actions(o) {
    const box = el('div', { class: 'actions' });
    const mine = o.createdBy === user.id;
    if (o.status === 'APPROVED') box.append(el('button', { class: 'small', type: 'button', onclick: () => deliver(o), text: 'Mark delivered' }));
    if (['APPROVED', 'PENDING_APPROVAL'].includes(o.status)) box.append(el('button', { class: 'small secondary', type: 'button', onclick: () => cancel(o), text: 'Cancel' }));
    if (isAdmin && o.status === 'PENDING_APPROVAL' && !mine) {
      box.append(el('button', { class: 'small', type: 'button', onclick: () => decide(o, 'APPROVE'), text: 'Approve' }),
        el('button', { class: 'small danger', type: 'button', onclick: () => decide(o, 'REJECT'), text: 'Reject' }));
    }
    if (o.conversionStatus === 'PENDING') box.append(el('button', { class: 'small secondary', type: 'button', onclick: () => retry(o), text: 'Retry EGP' }));
    if (o.status === 'DELIVERED' && mine && !isAdmin) box.append(el('a', { class: 'btn small secondary', href: 'evaluations.html?orderId=' + o.id, text: 'Rate' }));
    return box;
  }

  async function run(fn, okMsg, id) {
    try { await fn(); toast(okMsg); list(1); loadSummary(); if (id) showDetail(id); } catch (e) { toast(e.message, 'err'); }
  }
  function deliver(o) {
    const d = prompt(`Delivery date for ${o.orderNumber} (YYYY-MM-DD):`, todayIso());
    if (d === null) return;
    run(() => api.patch('order', `/api/orders/${o.id}/status`, { status: 'DELIVERED', deliveredDate: d }), `${o.orderNumber} marked delivered.`, o.id);
  }
  function cancel(o) {
    const note = prompt(`Reason for cancelling ${o.orderNumber}:`, '');
    if (note === null) return;
    run(() => api.patch('order', `/api/orders/${o.id}/status`, { status: 'CANCELLED', note: note || undefined }), `${o.orderNumber} cancelled.`, o.id);
  }
  function decide(o, decision) {
    const note = prompt(decision === 'APPROVE' ? 'Approval note (optional):' : 'Reason for rejecting (required):', '');
    if (note === null) return;
    run(() => api.patch('order', `/api/orders/${o.id}/approval`, { decision, note: note || undefined }), `${o.orderNumber} ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`, o.id);
  }
  function retry(o) { run(() => api.post('order', `/api/orders/${o.id}/convert`), `${o.orderNumber} converted to EGP.`, o.id); }

  // ---- F3 details
  async function showDetail(id) {
    const box = document.getElementById('order-detail');
    try {
      const { order: o, history } = await api.get('order', '/api/orders/' + encodeURIComponent(id));
      box.classList.remove('muted');
      box.replaceChildren(
        el('h3', {}, `${o.orderNumber} `, badge(o.status)),
        el('dl', { class: 'kv' },
          ...[['Supplier', o.supplierName], ['Item', `${o.description} × ${o.quantity} @ ${money(o.unitPrice, o.currency)}`],
            ['Amount', money(o.amount, o.currency)],
            ['EGP value', o.conversionStatus === 'PENDING' ? 'pending (rate unavailable)' : `${money(o.amountEgp, 'EGP')}${o.rateToEgp && o.currency !== 'EGP' ? ` @ ${o.rateToEgp} (${o.rateDate})` : ''}`],
            ['Ordered / expected', `${date(o.orderDate)} / ${date(o.expectedDate)}`],
            ['Delivered', o.deliveredDate ? `${date(o.deliveredDate)} - ${o.onTime ? 'on time' : o.daysLate + ' day(s) late'}` : '—'],
            ['Raised by', o.createdByName || o.createdBy], ['Approval note', o.approvalNote || '—']]
            .flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })])),
        el('h3', { text: 'History' }),
        table(['When', 'From', 'To', 'Note'], history.map((h) => el('tr', {}, el('td', { class: 'small', text: dateTime(h.changedAt) }), el('td', {}, h.from ? badge(h.from) : '—'), el('td', {}, badge(h.to)), el('td', { class: 'small', text: h.note || '' })))),
        el('div', { class: 'actions mt' }, actions(o)));
    } catch (e) { box.replaceChildren(el('div', { class: 'error-box', text: e.message })); }
  }

  // ---- F6 summary
  async function loadSummary() {
    try {
      const s = await api.get('order', '/api/orders/summary');
      const stat = (l, v) => el('div', { class: 'stat' }, el('div', { class: 'label', text: l }), el('div', { class: 'value', text: v }));
      document.getElementById('summary-stats').replaceChildren(stat('Orders', s.totals.orders), stat('Spend (EGP)', money(s.totals.spendEgp)),
        stat('Waiting approval', s.totals.pendingApproval), stat('Delivered', s.totals.delivered), stat('EGP pending', s.totals.pendingConversion));
      document.getElementById('by-supplier').replaceChildren(table(['Supplier', 'Orders', 'Spend (EGP)', 'Delivered', 'On-time rate', 'Avg. days late'],
        s.bySupplier.map((r) => el('tr', {}, el('td', { text: r.supplierName }), el('td', { class: 'num', text: r.orders }), el('td', { class: 'num', text: money(r.spendEgp) }),
          el('td', { class: 'num', text: r.delivered }), el('td', { class: 'num', text: r.onTimeRate === null ? '—' : r.onTimeRate + '%' }), el('td', { class: 'num', text: r.avgDaysLate === null ? '—' : r.avgDaysLate }))), 'No spending yet.'));
      document.getElementById('by-month').replaceChildren(table(['Month', 'Orders', 'Spend (EGP)'],
        s.byMonth.map((r) => el('tr', {}, el('td', { text: r.month }), el('td', { class: 'num', text: r.orders }), el('td', { class: 'num', text: money(r.spendEgp) }))), 'No spending yet.'));
    } catch (e) { document.getElementById('summary-stats').replaceChildren(el('div', { class: 'error-box', text: e.message })); }
  }

  try { await loadSuppliers(); } catch (e) { showError(document.getElementById('order-error'), e); }
  list(1); loadSummary();
  const pre = ui.params().get('id'); if (pre) showDetail(pre);
})();

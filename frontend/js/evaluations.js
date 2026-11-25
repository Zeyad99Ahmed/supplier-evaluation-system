// Evaluations page - Evaluation Service frontend (owner: Karim).
// F1 rate a delivered order, F5 edit/delete own rating, F4 history, F3 compare, F6 currency converter.
(async function () {
  const { el, badge, money, score, date, table, formData, showError, clearError, toast, stars, fillCurrencies, fillScores } = window.ui;
  const user = await auth.requireLogin();
  if (!user) return;
  fillCurrencies(); fillScores();
  const isStaff = user.role === 'staff';
  const rateForm = document.getElementById('rate-form');
  let editing = null;

  // Delivered orders of this user (Order Service) minus the ones already rated (Evaluation Service).
  async function loadRateableOrders() {
    if (!isStaff) return;
    const [orders, mine] = await Promise.all([
      api.get('order', '/api/orders?status=DELIVERED&limit=100'),
      api.get('evaluation', '/api/evaluations?mine=true&limit=100'),
    ]);
    const rated = new Set(mine.evaluations.map((e) => e.orderId));
    const open = orders.orders.filter((o) => !rated.has(o.id));
    document.getElementById('r-order').replaceChildren(el('option', { value: '', text: open.length ? 'Choose one of your delivered orders…' : 'No delivered orders waiting for a rating' }),
      ...open.map((o) => el('option', { value: o.id, text: `${o.orderNumber} - ${o.supplierName} - ${o.description} (${o.onTime ? 'on time' : o.daysLate + 'd late'})` })));
    const pre = ui.params().get('orderId');
    if (pre && open.some((o) => o.id === pre)) rateForm.orderId.value = pre;
  }

  async function loadSuppliers() {
    const res = await api.get('supplier', '/api/suppliers?limit=100');
    const opts = res.suppliers.map((s) => el('option', { value: s.id, text: `${s.name} (${score(s.performance.avgScore)})` }));
    document.getElementById('cmp-suppliers').replaceChildren(...opts.map((o) => o.cloneNode(true)));
    document.getElementById('f-supplier').replaceChildren(el('option', { value: '', text: 'All suppliers' }), ...opts);
  }

  function resetForm() {
    editing = null; rateForm.reset(); fillScores();
    rateForm.orderId.disabled = false;
    document.getElementById('rate-title').textContent = 'Rate a delivered order';
    document.getElementById('rate-btn').textContent = 'Submit rating';
    document.getElementById('cancel-edit').hidden = true;
  }
  document.getElementById('cancel-edit').addEventListener('click', resetForm);

  rateForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('rate-error');
    clearError(errBox);
    const f = formData(rateForm);
    const body = { quality: Number(f.quality), price: Number(f.price), delivery: Number(f.delivery), comment: f.comment };
    try {
      let res;
      if (editing) res = await api.put('evaluation', '/api/evaluations/' + editing, body);
      else res = await api.post('evaluation', '/api/evaluations', { ...body, orderId: f.orderId });
      const p = res.supplierPerformance;
      toast(`Rating saved (overall ${score(res.evaluation.overall)}). Supplier average is now ${score(p.avgScore)} from ${p.ratingCount} rating(s)` +
        (p.supplierStatusChanged ? ' - the supplier was put UNDER REVIEW.' : '.'));
      resetForm(); await loadRateableOrders(); history(); loadSuppliers();
    } catch (err) { showError(errBox, err); }
  });

  // ---- F4 history (+ F5 edit/delete for own ratings)
  const filterForm = document.getElementById('filter-form');
  async function history() {
    const box = document.getElementById('history');
    try {
      const res = await api.get('evaluation', '/api/evaluations' + api.qs({ ...formData(filterForm), limit: 50 }));
      box.replaceChildren(table(['Date', 'Order', 'Supplier', 'Quality', 'Price', 'Delivery', 'Overall', 'On time', 'Comment', 'By', ''],
        res.evaluations.map((ev) => el('tr', {},
          el('td', { text: date(ev.createdAt) }), el('td', { text: ev.orderNumber || '—' }), el('td', { text: ev.supplierName || '—' }),
          el('td', {}, stars(ev.quality)), el('td', {}, stars(ev.price)), el('td', {}, stars(ev.delivery)),
          el('td', { class: 'num', text: score(ev.overall) }), el('td', { text: ev.onTime === null ? '—' : ev.onTime ? 'Yes' : 'No' }),
          el('td', { class: 'small', text: ev.comment || '' }), el('td', { class: 'small', text: ev.ratedBy === user.id ? 'You' : (ev.ratedByName || '—') }),
          el('td', {}, ev.ratedBy === user.id ? el('div', { class: 'actions' },
            el('button', { class: 'small secondary', type: 'button', onclick: () => startEdit(ev), text: 'Edit' }),
            el('button', { class: 'small danger', type: 'button', onclick: () => remove(ev), text: 'Delete' })) : ''))),
        'No ratings match these filters.'));
    } catch (e) { box.replaceChildren(el('div', { class: 'error-box', text: e.message })); }
  }
  filterForm.addEventListener('submit', (e) => { e.preventDefault(); history(); });

  function startEdit(ev) {
    editing = ev.id;
    rateForm.orderId.replaceChildren(el('option', { value: ev.orderId, text: `${ev.orderNumber} - ${ev.supplierName}` }));
    rateForm.orderId.disabled = true;
    rateForm.quality.value = ev.quality; rateForm.price.value = ev.price; rateForm.delivery.value = ev.delivery; rateForm.comment.value = ev.comment || '';
    document.getElementById('rate-title').textContent = `Edit rating for ${ev.orderNumber}`;
    document.getElementById('rate-btn').textContent = 'Save changes';
    document.getElementById('cancel-edit').hidden = false;
    rateForm.scrollIntoView({ behavior: 'smooth' });
  }
  async function remove(ev) {
    if (!confirm(`Delete your rating for ${ev.orderNumber}?`)) return;
    try { await api.del('evaluation', '/api/evaluations/' + ev.id); toast('Rating deleted.'); history(); loadRateableOrders(); } catch (e) { toast(e.message, 'err'); }
  }

  // ---- F3 compare
  document.getElementById('compare-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('compare-error');
    clearError(errBox);
    const ids = [...document.getElementById('cmp-suppliers').selectedOptions].map((o) => o.value);
    try {
      const res = await api.get('evaluation', '/api/performance/compare?supplierIds=' + ids.map(encodeURIComponent).join(','));
      const best = res.bestBy;
      const cell = (r, key) => el('td', { class: 'num' + (best[key] === r.supplierId ? ' best' : ''), text: score(r.averages[key]) + (best[key] === r.supplierId ? ' ★' : '') });
      document.getElementById('compare-result').replaceChildren(table(['Rank', 'Supplier', 'Overall', 'Quality', 'Price', 'Delivery', 'On time', 'Ratings', 'Spend (EGP)', 'Trend'],
        res.ranking.map((rk) => {
          const r = res.suppliers.find((s) => s.supplierId === rk.supplierId);
          return el('tr', {}, el('td', { text: rk.rank }), el('td', { text: r.supplierName || 'Not rated yet' }), cell(r, 'overall'), cell(r, 'quality'), cell(r, 'price'), cell(r, 'delivery'),
            el('td', { class: 'num', text: r.onTimeRate === null ? '—' : r.onTimeRate + '%' }), el('td', { class: 'num', text: r.ratingCount }),
            el('td', { class: 'num', text: money(r.spending.totalEgp) }), el('td', { text: r.trend.direction }));
        })));
    } catch (err) { showError(errBox, err); }
  });

  // ---- F6 converter (ExchangeRate API through the Evaluation Service)
  document.getElementById('conv-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('conv-error');
    clearError(errBox);
    try {
      const r = await api.get('evaluation', '/api/rates/convert' + api.qs(formData(e.target)));
      document.getElementById('conv-result').textContent = `${money(r.amount, r.currency)} = ${money(r.amountEgp, 'EGP')} · 1 ${r.currency} = ${r.rateToEgp} EGP (rate date ${r.rateDate}${r.stale ? ', cached rate - provider unavailable' : ''}) · ${r.provider}`;
    } catch (err) { showError(errBox, err); }
  });

  try { await Promise.all([loadRateableOrders(), loadSuppliers()]); } catch (e) { showError(document.getElementById('rate-error'), e); }
  history();
})();

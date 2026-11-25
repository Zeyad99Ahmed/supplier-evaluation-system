// Supplier detail page - Supplier Service frontend (owner: Zeyad).
// F4 details, F3 edit, F5 contracts, F6 status workflow, F8 archive, contacts,
// plus the performance panel served by the Evaluation Service (Karim) - cross-service view.
(async function () {
  const { el, badge, score, money, date, dateTime, table, formData, showError, clearError, toast, bar, fillCurrencies } = window.ui;
  const user = await auth.requireLogin();
  if (!user) return;
  fillCurrencies();
  const id = ui.params().get('id');
  const isAdmin = user.role === 'admin';
  let current;

  async function load() {
    const errBox = document.getElementById('load-error');
    clearError(errBox);
    let res;
    try { res = await api.get('supplier', '/api/suppliers/' + encodeURIComponent(id || 'missing')); } catch (e) { showError(errBox, e); return; }
    current = res;
    const s = res.supplier;
    document.title = s.name + ' · Supplier Directory';
    document.getElementById('s-name').textContent = s.name;
    document.getElementById('s-badges').replaceChildren(badge(s.status), ' ', el('span', { class: 'muted small', text: s.statusReason || '' }));
    document.getElementById('raise-order').href = 'orders.html?supplierId=' + s.id;
    document.getElementById('raise-order').hidden = s.status !== 'ACTIVE';
    const kv = [['Category', s.category], ['E-mail', s.email], ['Phone', s.phone || '—'], ['Address', s.address || '—'], ['Country', s.country || '—'],
      ['Current contract', s.hasCurrentContract ? 'Yes' : 'No'], ['Registered', dateTime(s.createdAt)]];
    document.getElementById('s-profile').replaceChildren(...kv.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v })]));

    document.getElementById('s-contracts').replaceChildren(table(['Title', 'Period', 'Value', 'Value (EGP)', 'Rate', 'Status', ''],
      res.contracts.map((c) => el('tr', {},
        el('td', { text: c.title }), el('td', { text: `${c.startDate} → ${c.endDate}` }),
        el('td', { class: 'num', text: money(c.value, c.currency) }),
        el('td', { class: 'num', text: c.valueEgp === null ? 'pending' : money(c.valueEgp) }),
        el('td', { class: 'small', text: c.rateToEgp === null ? '—' : `${c.rateToEgp} (${c.rateDate})` }),
        el('td', {}, badge(c.isCurrent ? 'ACTIVE' : c.status === 'ACTIVE' ? 'not current' : c.status)),
        el('td', {}, isAdmin && c.status === 'ACTIVE' ? el('button', { class: 'small secondary', type: 'button', onclick: () => terminate(c), text: 'Terminate' }) : ''))),
      'No contracts yet.'));

    document.getElementById('s-contacts').replaceChildren(table(['Name', 'Job title', 'E-mail', 'Phone', ''],
      res.contacts.map((c) => el('tr', {}, el('td', { text: c.name }), el('td', { text: c.jobTitle || '—' }), el('td', { text: c.email || '—' }), el('td', { text: c.phone || '—' }),
        el('td', {}, isAdmin ? el('button', { class: 'small secondary', type: 'button', onclick: () => removeContact(c), text: 'Remove' }) : ''))),
      'No contacts yet.'));

    document.getElementById('s-history').replaceChildren(table(['When', 'From', 'To', 'Reason'],
      res.statusHistory.map((h) => el('tr', {}, el('td', { class: 'small', text: dateTime(h.changedAt) }), el('td', {}, h.from ? badge(h.from) : '—'), el('td', {}, badge(h.to)), el('td', { class: 'small', text: h.reason || '' })))));

    if (isAdmin) {
      const f = document.getElementById('edit-form');
      document.getElementById('e-category').replaceChildren(...(await api.get('supplier', '/api/categories')).categories.map((c) => el('option', { value: c.id, text: c.name })));
      f.name.value = s.name; f.categoryId.value = s.categoryId; f.email.value = s.email;
      f.phone.value = s.phone || ''; f.address.value = s.address || ''; f.country.value = s.country || '';
      document.getElementById('status-form').hidden = s.status === 'ARCHIVED';
      document.getElementById('contract-form').hidden = s.status === 'ARCHIVED';
    }
    loadPerformance(s.id);
  }

  // Cross-service: Evaluation Service report for this supplier
  async function loadPerformance(supplierId) {
    const box = document.getElementById('s-performance');
    try {
      const { report: r } = await api.get('evaluation', '/api/performance/suppliers/' + supplierId);
      if (!r.ratingCount) { box.replaceChildren(el('p', { class: 'muted', text: 'No ratings yet. Ratings appear after delivered orders are evaluated.' })); return; }
      box.replaceChildren(
        bar('Overall', r.averages.overall, 5), bar('Quality', r.averages.quality, 5), bar('Price', r.averages.price, 5), bar('Delivery', r.averages.delivery, 5),
        el('dl', { class: 'kv mt' },
          el('dt', { text: 'Ratings' }), el('dd', { text: r.ratingCount }),
          el('dt', { text: 'On-time deliveries' }), el('dd', { text: r.onTimeRate === null ? '—' : r.onTimeRate + '%' }),
          el('dt', { text: 'Trend (90 days)' }), el('dd', { text: `${r.trend.direction}${r.trend.last90Days !== null ? ' · recent ' + score(r.trend.last90Days) : ''}` }),
          el('dt', { text: 'Spend (EGP ledger)' }), el('dd', { text: `${money(r.spending.totalEgp)} EGP over ${r.spending.convertedOrders} order(s)${r.spending.currencies.length ? ' in ' + r.spending.currencies.join(', ') : ''}` }),
          el('dt', { text: 'Last rated' }), el('dd', { text: dateTime(r.lastRatedAt) })));
    } catch (e) { box.replaceChildren(el('p', { class: 'error-box', text: 'Evaluation Service unavailable: ' + e.message })); }
  }

  async function terminate(c) {
    if (!confirm(`Terminate contract "${c.title}"? Orders can no longer be raised against it.`)) return;
    try { await api.patch('supplier', '/api/contracts/' + c.id, { status: 'TERMINATED' }); toast('Contract terminated.'); load(); } catch (e) { toast(e.message, 'err'); }
  }
  async function removeContact(c) {
    if (!confirm(`Remove contact ${c.name}?`)) return;
    try { await api.del('supplier', `/api/suppliers/${id}/contacts/${c.id}`); toast('Contact removed.'); load(); } catch (e) { toast(e.message, 'err'); }
  }

  const submit = (formId, errId, fn) => document.getElementById(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById(errId);
    clearError(errBox);
    try { await fn(formData(e.target), e.target); load(); } catch (err) { showError(errBox, err); }
  });

  submit('contract-form', 'contract-error', async (f, form) => {
    const res = await api.post('supplier', `/api/suppliers/${id}/contracts`, { ...f, value: f.value ? Number(f.value) : undefined });
    toast(res.conversion === 'PENDING' ? 'Contract added. EGP conversion pending (rate service unavailable).' : 'Contract added and converted to EGP.');
    form.reset(); fillCurrencies();
  });
  submit('contact-form', 'contact-error', async (f, form) => { await api.post('supplier', `/api/suppliers/${id}/contacts`, f); toast('Contact added.'); form.reset(); });
  submit('status-form', 'status-error', async (f, form) => { await api.patch('supplier', `/api/suppliers/${id}/status`, f); toast('Status changed.'); form.reset(); });
  submit('edit-form', 'edit-error', async (f) => {
    await api.put('supplier', `/api/suppliers/${id}`, { ...f, categoryId: Number(f.categoryId) }); toast('Profile saved.');
  });

  document.getElementById('archive-btn').addEventListener('click', async () => {
    if (!confirm('Archive this supplier? This is refused while it has open orders.')) return;
    const errBox = document.getElementById('status-error');
    clearError(errBox);
    try { await api.del('supplier', `/api/suppliers/${id}`); toast('Supplier archived.'); load(); } catch (e) { showError(errBox, e); }
  });

  load();
})();

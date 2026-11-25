// Supplier directory page - Supplier Service frontend (owner: Zeyad).
// F2 search/filter, F7 recommendations, F1 create supplier (admin), categories (admin).
(async function () {
  const { el, badge, score, table, formData, showError, clearError, toast, pager } = window.ui;
  const user = await auth.requireLogin();
  if (!user) return;

  let categories = [];
  async function loadCategories() {
    const res = await api.get('supplier', '/api/categories');
    categories = res.categories;
    const opts = (withAll) => [
      ...(withAll ? [el('option', { value: '', text: 'All categories' })] : []),
      ...categories.map((c) => el('option', { value: c.id, text: `${c.name} (${c.supplierCount})` })),
    ];
    document.getElementById('f-category').replaceChildren(...opts(true));
    document.getElementById('rec-category').replaceChildren(...opts(false));
    document.getElementById('c-category').replaceChildren(...opts(false));
  }

  // ---- F2 search / filter
  const filterForm = document.getElementById('filter-form');
  let page = 1;
  async function search(p = 1) {
    page = p;
    const errBox = document.getElementById('filter-error');
    clearError(errBox);
    try {
      const res = await api.get('supplier', '/api/suppliers' + api.qs({ ...formData(filterForm), page, limit: 10 }));
      document.getElementById('supplier-list').replaceChildren(table(
        ['Name', 'Category', 'E-mail', 'Status', 'Contract', 'Score', 'Ratings', 'On time'],
        res.suppliers.map((s) => el('tr', {},
          el('td', {}, el('a', { href: 'supplier.html?id=' + s.id, text: s.name })),
          el('td', { text: s.category }), el('td', { text: s.email }), el('td', {}, badge(s.status)),
          el('td', { text: s.hasCurrentContract ? 'Current' : 'None' }),
          el('td', { class: 'num', text: score(s.performance.avgScore) }),
          el('td', { class: 'num', text: s.performance.ratingCount }),
          el('td', { class: 'num', text: s.performance.onTimeRate === null ? '—' : s.performance.onTimeRate.toFixed(0) + '%' }))),
        'No suppliers match these filters.'));
      pager(document.getElementById('pager'), res.page, res.limit, res.total, search);
    } catch (e) { showError(errBox, e); }
  }
  filterForm.addEventListener('submit', (e) => { e.preventDefault(); search(1); });
  filterForm.addEventListener('reset', () => setTimeout(() => search(1), 0));

  // ---- F7 recommendations
  document.getElementById('rec-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('rec-error');
    clearError(errBox);
    try {
      const res = await api.get('supplier', '/api/suppliers/recommendations' + api.qs(formData(e.target)));
      document.getElementById('rec-list').replaceChildren(table(['#', 'Supplier', 'Why'],
        res.recommendations.map((r) => el('tr', {}, el('td', { text: r.rank }), el('td', {}, el('a', { href: 'supplier.html?id=' + r.id, text: r.name })), el('td', { class: 'small', text: r.reason }))),
        'No eligible supplier in this category (none is active with a current contract).'));
    } catch (err) { showError(errBox, err); }
  });

  // ---- F1 create supplier (admin; the backend rejects staff with 403 anyway)
  document.getElementById('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('create-error');
    clearError(errBox);
    const f = formData(e.target);
    const body = { name: f.name, categoryId: f.categoryId ? Number(f.categoryId) : undefined, email: f.email, phone: f.phone, address: f.address, country: f.country };
    if (f.contactName) body.contact = { name: f.contactName, jobTitle: f.contactJobTitle, email: f.contactEmail };
    try {
      const res = await api.post('supplier', '/api/suppliers', body);
      toast(`Supplier "${res.supplier.name}" created.`);
      e.target.reset();
      await loadCategories(); search(1);
    } catch (err) { showError(errBox, err); }
  });

  document.getElementById('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('cat-error');
    clearError(errBox);
    try {
      const res = await api.post('supplier', '/api/categories', formData(e.target));
      toast(`Category "${res.category.name}" added.`); e.target.reset(); await loadCategories();
    } catch (err) { showError(errBox, err); }
  });

  try { await loadCategories(); } catch (e) { showError(document.getElementById('filter-error'), e); }
  search(1);
})();

// Shared UI helpers. All user-supplied text is inserted with textContent (never innerHTML), which
// prevents stored XSS from supplier names or rating comments (threat model T7).
(function () {
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c))); });
    return node;
  }

  function toast(message, type) {
    const box = document.getElementById('toast') || document.body.appendChild(el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }));
    const t = el('div', { class: 'toast ' + (type || 'ok'), text: message });
    box.append(t);
    setTimeout(() => t.remove(), 4500);
  }

  // Shows an API error next to a form (with the per-field details from the backend).
  function showError(target, err) {
    target.replaceChildren();
    target.hidden = false;
    target.append(el('strong', { text: err.message || 'Something went wrong.' }));
    if (err.details && err.details.length) target.append(el('ul', {}, err.details.map((d) => el('li', { text: (d.field ? d.field + ': ' : '') + d.message }))));
  }
  const clearError = (target) => { target.hidden = true; target.replaceChildren(); };

  const money = (v, cur) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : ''));
  const score = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
  const date = (v) => (v ? String(v).slice(0, 10) : '—');
  const dateTime = (v) => (v ? new Date(v).toLocaleString() : '—');
  const badge = (text) => el('span', { class: 'badge badge-' + String(text).toLowerCase().replace(/_/g, '-'), text: String(text).replace(/_/g, ' ') });
  const stars = (n) => el('span', { class: 'stars', title: n + ' / 5', text: '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n)) });

  function formData(form) {
    const out = {};
    new FormData(form).forEach((v, k) => { if (String(v).trim() !== '') out[k] = typeof v === 'string' ? v.trim() : v; });
    return out;
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return el('p', { class: 'muted', text: emptyText || 'Nothing to show.' });
    return el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', { text: h })))),
      el('tbody', {}, rows)));
  }

  const params = () => new URLSearchParams(location.search);
  const todayIso = () => new Date().toISOString().slice(0, 10);

  const CURRENCIES = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'CNY', 'JPY', 'CHF', 'CAD', 'TRY', 'KWD'];
  function fillCurrencies() {
    document.querySelectorAll('select.currency-select').forEach((s) => s.replaceChildren(...CURRENCIES.map((c) => el('option', { value: c, text: c }))));
  }
  function fillScores() {
    document.querySelectorAll('select.score-select').forEach((s) => s.replaceChildren(...[5, 4, 3, 2, 1].map((n) => el('option', { value: n, text: n + ' - ' + ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'][n - 1] }))));
  }
  function pager(target, page, limit, total, go) {
    const pages = Math.max(1, Math.ceil(total / limit));
    target.replaceChildren(
      el('button', { class: 'secondary small', type: 'button', disabled: page <= 1, onclick: () => go(page - 1), text: 'Previous' }),
      el('span', { class: 'muted small', text: `Page ${page} of ${pages} · ${total} result(s)` }),
      el('button', { class: 'secondary small', type: 'button', disabled: page >= pages, onclick: () => go(page + 1), text: 'Next' }));
  }
  function bar(label, value, max) {
    const fill = el('div', { class: 'fill' });
    fill.style.width = (value === null || value === undefined ? 0 : Math.min(100, (value / max) * 100)) + '%';
    return el('div', { class: 'bar' }, el('span', { text: label }), el('div', { class: 'track' }, fill), el('span', { class: 'num', text: value === null || value === undefined ? '—' : Number(value).toFixed(2) }));
  }

  window.ui = { CURRENCIES, fillCurrencies, fillScores, pager, bar, el, toast, showError, clearError, money, score, date, dateTime, badge, stars, formData, table, params, todayIso };
})();

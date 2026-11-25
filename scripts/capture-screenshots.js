// Captures report screenshots of the RUNNING application with the installed Chrome (puppeteer-core).
//   node scripts/capture-screenshots.js [baseUrl]     default http://localhost:8080
// Output: evidence/screenshots/NN-name.png. Credentials come from the git-ignored .env.local and are
// typed into the login form only (never printed).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { parseEnv, LOCAL_ENV, ROOT } = require('./lib/env');

const env = { ...parseEnv(LOCAL_ENV), ...process.env }; // process.env wins (e.g. Floci admin from infra/.env.floci)
const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = path.join(ROOT, 'evidence', process.env.SHOT_DIR || 'screenshots');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
async function shot(page, name, { full = true } = {}) {
  n += 1;
  const file = path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`);
  await wait(700);
  await page.screenshot({ path: file, fullPage: full });
  console.log('saved', path.relative(ROOT, file));
}

async function login(page, email, password) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => sessionStorage.clear());
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
  await page.type('input[name=email]', email);
  await page.type('input[name=password]', password);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), page.click('#login-btn')]);
}

async function supplierId(page, name) {
  return page.evaluate(async (nm) => (await api.get('supplier', '/api/suppliers?search=' + encodeURIComponent(nm))).suppliers[0].id, name);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1366, height: 860 } });
  const page = await browser.newPage();
  page.on('dialog', (d) => d.dismiss());
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // 1-2 login page + failed login
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle0' });
  await shot(page, 'login-page', { full: false });
  await page.type('input[name=email]', env.ADMIN_EMAIL);
  await page.type('input[name=password]', 'wrong-password-1');
  await page.click('#login-btn');
  await page.waitForSelector('#login-error:not([hidden])');
  await shot(page, 'login-failed-generic-message', { full: false });

  // ---------------- admin
  await login(page, env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  await shot(page, 'admin-dashboard');
  await page.goto(`${BASE}/suppliers.html`, { waitUntil: 'networkidle0' });
  await shot(page, 'supplier-directory-admin');
  await page.select('#rec-category', String(await page.evaluate(async () => (await api.get('supplier', '/api/categories')).categories.find((c) => c.name === 'Electronics').id)));
  await page.click('#rec-form button[type=submit]');
  await wait(800);
  await page.evaluate(() => document.getElementById('rec-form').scrollIntoView());
  await shot(page, 'supplier-recommendations', { full: false });
  // invalid create -> backend validation messages
  await page.evaluate(() => document.getElementById('create-form').scrollIntoView());
  await page.type('#create-form input[name=email]', 'not-an-email');
  await page.click('#create-form button[type=submit]');
  await page.waitForSelector('#create-error:not([hidden])');
  await shot(page, 'supplier-create-validation-errors', { full: false });

  const nile = await supplierId(page, 'Nile Electronics');
  await page.goto(`${BASE}/supplier.html?id=${nile}`, { waitUntil: 'networkidle0' });
  await shot(page, 'supplier-detail-contracts-performance');
  const sz = await supplierId(page, 'Shenzhen');
  await page.goto(`${BASE}/supplier.html?id=${sz}`, { waitUntil: 'networkidle0' });
  await shot(page, 'supplier-auto-under-review-history');

  await page.goto(`${BASE}/orders.html`, { waitUntil: 'networkidle0' });
  await shot(page, 'orders-admin-approvals-summary');
  await page.goto(`${BASE}/evaluations.html`, { waitUntil: 'networkidle0' });
  // compare 3 suppliers
  await page.evaluate(() => { const s = document.getElementById('cmp-suppliers'); [...s.options].forEach((o) => { o.selected = /Nile|Shenzhen|Delta/.test(o.text); }); });
  await page.click('#compare-form button[type=submit]');
  await wait(900);
  await shot(page, 'evaluations-compare-admin');
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle0' });
  await shot(page, 'admin-security-monitoring');

  // ---------------- staff
  await login(page, 'sara.hassan@ses.local', env.DEMO_STAFF_PASSWORD);
  await shot(page, 'staff-dashboard');
  await page.goto(`${BASE}/orders.html`, { waitUntil: 'networkidle0' });
  const delta = await supplierId(page, 'Delta');
  await page.select('#o-supplier', delta);
  await page.type('#order-form input[name=description]', 'Corrugated boxes');
  await page.type('#order-form input[name=quantity]', '300');
  await page.type('#order-form input[name=unitPrice]', '1.8');
  await page.select('#order-form select[name=currency]', 'USD');
  await page.type('#order-form input[name=expectedDate]', '');
  await page.evaluate(() => { document.querySelector('#order-form input[name=expectedDate]').value = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10); });
  await wait(1200);
  await shot(page, 'order-form-live-egp-conversion', { full: false });
  await page.click('#order-form button[type=submit]');
  await wait(1500);
  await shot(page, 'order-created-staff-view');
  // business-rule rejection: supplier with no contract is not in the active list; use the API directly via the form for Shenzhen (under review)
  await page.evaluate((id) => {
    const s = document.getElementById('o-supplier'); s.append(new Option('Shenzhen Components Ltd (under review)', id)); s.value = id;
    const f = document.getElementById('order-form');
    f.description.value = 'Voltage regulators'; f.quantity.value = '100'; f.unitPrice.value = '3'; f.currency.value = 'CNY';
    f.expectedDate.value = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  }, sz);
  await page.click('#order-form button[type=submit]');
  await page.waitForSelector('#order-error:not([hidden])');
  await page.evaluate(() => document.getElementById('order-form').scrollIntoView());
  await shot(page, 'order-rejected-supplier-under-review', { full: false });

  await page.goto(`${BASE}/evaluations.html`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => { const f = document.getElementById('conv-form'); f.amount.value = '1000'; f.currency.value = 'EUR'; });
  await page.click('#conv-form button[type=submit]');
  await wait(900);
  await shot(page, 'evaluations-staff-rate-history-converter');
  // invalid rating -> backend 400 shown (quality forced to 9)
  await page.evaluate(() => { const s = document.querySelector('#rate-form select[name=quality]'); s.append(new Option('9 (tampered)', '9')); s.value = '9'; const o = document.getElementById('r-order'); if (o.options.length < 2) o.append(new Option('fake', '00000000-0000-4000-8000-000000000000')); o.selectedIndex = 1; });
  await page.click('#rate-btn');
  await page.waitForSelector('#rate-error:not([hidden])');
  await page.evaluate(() => document.getElementById('rate-form').scrollIntoView());
  await shot(page, 'rating-invalid-score-rejected', { full: false });

  // staff opens the admin page -> blocked (frontend) and the API answers 403 (backend)
  await page.goto(`${BASE}/admin.html`, { waitUntil: 'networkidle0' });
  const apiResult = await page.evaluate(async () => { try { await api.get('auth', '/api/users'); return 'allowed?!'; } catch (e) { return `${e.status} ${e.code}: ${e.message}`; } });
  await page.evaluate((txt) => { document.querySelector('main').append(Object.assign(document.createElement('pre'), { className: 'error-box', textContent: 'Direct API call GET /api/users as Staff -> ' + txt })); }, apiResult);
  await shot(page, 'staff-blocked-admin-403', { full: false });

  await browser.close();
  console.log(errors.length ? `Console errors (expected 4xx from deliberate tests): ${errors.length}` : 'No console errors.');
})().catch((e) => { console.error(e); process.exit(1); });

// Records the demo video (max 5 minutes, no commentary) of the application DEPLOYED ON FLOCI:
// main end-to-end scenario first, then the security scenarios, monitoring and the Floci resources.
//   node scripts/record-demo.js <out.mp4>
// Needs: Floci up (website http://localhost:4566/ses-web), Floci Dash (http://localhost:4500), FFmpeg (FFMPEG_DIR),
// demo data (scripts/seed-demo.js). Credentials are read from the git-ignored env files and typed into the
// login form only (the password field is masked in the video).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');
const { parseEnv, LOCAL_ENV, ROOT } = require('./lib/env');
const { buildApiEvidenceHtml } = require('./lib/api-evidence');

const floci = parseEnv(path.join(ROOT, 'infra', '.env.floci'));
const local = parseEnv(LOCAL_ENV);
const SITE = 'http://localhost:4566/ses-web';
const DASH = 'http://localhost:4500';
const FFDIR = process.env.FFMPEG_DIR || 'D:/Tools/ffmpeg/ffmpeg-9.1-essentials_build/bin';
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '..', 'SUBMISSION', 'Group26_Demo_Video.mp4'));
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const ADMIN = { email: floci.ADMIN_EMAIL, pw: floci.ADMIN_PASSWORD };
const OMAR = { email: 'omar.khaled@ses.local', pw: local.DEMO_STAFF_PASSWORD };
const SARA = { email: 'sara.hassan@ses.local', pw: local.DEMO_STAFF_PASSWORD };
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

let page; const dialogAnswers = [];

async function caption(title, sub = '') {
  await page.evaluate((t, s) => {
    let bar = document.getElementById('demo-caption');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'demo-caption';
      Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '9999', background: 'rgba(15,23,42,.92)', color: '#fff', padding: '10px 22px', fontFamily: 'Segoe UI, Arial', boxShadow: '0 -2px 12px rgba(0,0,0,.25)' });
      const a = document.createElement('div'); a.id = 'demo-cap-t'; Object.assign(a.style, { fontSize: '20px', fontWeight: '700' });
      const b = document.createElement('div'); b.id = 'demo-cap-s'; Object.assign(b.style, { fontSize: '15px', opacity: '.9', marginTop: '2px' });
      bar.append(a, b); document.body.append(bar);
    }
    document.getElementById('demo-cap-t').textContent = t;
    document.getElementById('demo-cap-s').textContent = s;
  }, title, sub);
}
async function go(url) { await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 }); }
async function slowType(sel, text) { await page.click(sel, { clickCount: 3 }); await page.type(sel, String(text), { delay: 35 }); }
async function setValue(sel, value) { await page.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value); }
async function selectByText(sel, text) {
  const v = await page.$eval(sel, (el, t) => { const o = [...el.options].find((x) => x.text.includes(t)); return o ? o.value : null; }, text);
  if (!v) throw new Error(`option "${text}" not found in ${sel}`);
  await page.select(sel, v);
}
async function clickText(scope, text) {
  const ok = await page.evaluate((s, t) => { const el = [...document.querySelectorAll(`${s} button, ${s} a`)].find((b) => b.textContent.trim() === t); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true; }, scope, text);
  if (!ok) throw new Error(`no "${text}" in ${scope}`);
}
async function scrollTo(sel) { await page.$eval(sel, (el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' })); await pause(700); }
async function login(user, title) {
  await go(`${SITE}/index.html`);
  await page.evaluate(() => sessionStorage.clear());
  await go(`${SITE}/index.html`);
  await caption(title, `Signing in as ${user.email}`);
  await pause(900);
  await slowType('input[name=email]', user.email);
  await slowType('input[name=password]', user.pw);
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 120000 }), page.click('#login-btn')]);
}
const apiGet = (svc, p) => page.evaluate((s, x) => api.get(s, x), svc, p);

function alarmState() {
  try {
    return execFileSync('aws', ['cloudwatch', 'describe-alarms', '--alarm-names', 'ses-repeated-failed-logins', '--query', 'MetricAlarms[0].StateValue', '--output', 'text', '--profile', 'floci'], { encoding: 'utf8' }).trim();
  } catch (_) { return 'unknown'; }
}

(async () => {
  // Pre-condition for the monitoring scene: repeated failed logins so the CloudWatch alarm is in ALARM.
  const urls = parseEnv(path.join(ROOT, 'infra', 'floci-urls.env'));
  for (let i = 0; i < 6; i++) {
    await fetch(`${urls.AUTH_API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `intruder${i}@example.com`, password: `Guess${i}password` }) });
  }
  for (let i = 0; i < 24 && alarmState() !== 'ALARM'; i++) await pause(10000);
  console.log('alarm before recording:', alarmState());

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1366, height: 768 } });
  page = await browser.newPage();
  // Floci Dash runs as a side container started on first visit of /_floci/ui: start it before recording.
  await page.goto('http://localhost:4566/_floci/ui', { waitUntil: 'domcontentloaded' }).catch(() => {});
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${DASH}/console/aws`); if (r.ok) break; } catch (_) { /* starting */ }
    await pause(3000);
  }
  console.log('Floci Dash ready');
  const apiHtml = await buildApiEvidenceHtml(); // live AWS CLI data (Floci Dash does not list HTTP APIs)
  page.on('dialog', async (d) => { const a = dialogAnswers.shift(); if (d.type() === 'prompt') await d.accept(a !== undefined ? a : d.defaultValue()); else await d.accept(); });
  const webm = OUT.replace(/\.mp4$/, '.webm');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await go(`${SITE}/index.html`);
  const rec = await page.screencast({ path: webm, ffmpegPath: path.join(FFDIR, 'ffmpeg.exe') });
  const t0 = Date.now();
  const mark = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${s}`);

  // ---------------------------------------------------------------- intro
  mark('intro');
  await caption('Supplier Directory & Evaluation System - Group 26', 'Deployed on Floci: website on Amazon S3 (localhost:4566/ses-web) - 4 API Gateway HTTP APIs - 4 Lambda functions - PostgreSQL');
  await pause(6500);

  // ---------------------------------------------------------------- main end-to-end scenario
  mark('admin login');
  await login(ADMIN, 'Main scenario 1/7 - Admin (Procurement Manager) signs in');
  await caption('Dashboard', 'One application: data from the Supplier, Order and Evaluation services, shared login and navigation');
  await pause(4500);

  mark('create supplier');
  await go(`${SITE}/suppliers.html`);
  await caption('Main scenario 2/7 - Admin registers a supplier', 'Supplier Service (Zeyad): POST /api/suppliers - Admin only, validated in the backend');
  await scrollTo('#create-form');
  await slowType('#create-form input[name=name]', 'Giza Steel Works');
  await selectByText('#c-category', 'Raw Materials');
  await slowType('#create-form input[name=email]', 'sales@giza-steel.example');
  await slowType('#create-form input[name=phone]', '+20 2 3333 4444');
  await slowType('#create-form input[name=country]', 'Egypt');
  await slowType('#create-form input[name=contactName]', 'Ahmed Samir');
  await page.click('#create-form button[type=submit]');
  await pause(2500);
  const giza = (await apiGet('supplier', '/api/suppliers?search=Giza')).suppliers[0];

  mark('contract');
  await go(`${SITE}/supplier.html?id=${giza.id}`);
  await caption('Main scenario 3/7 - Admin adds a contract in USD', 'The Supplier Service calls the Evaluation Service, which converts USD to EGP with the ExchangeRate API (rate + date stored)');
  await scrollTo('#contract-form');
  await slowType('#contract-form input[name=title]', 'Steel supply 2026-2027');
  await setValue('#contract-form input[name=startDate]', day(-10));
  await setValue('#contract-form input[name=endDate]', day(355));
  await slowType('#contract-form input[name=value]', '50000');
  await page.select('#contract-form select[name=currency]', 'USD');
  await pause(600);
  await page.click('#contract-form button[type=submit]');
  await pause(2500);
  await scrollTo('#s-contracts');
  await pause(4500);

  mark('staff order');
  await login(OMAR, 'Main scenario 4/7 - Staff member raises a purchase order');
  await go(`${SITE}/orders.html`);
  await caption('Main scenario 4/7 - Staff raises a purchase order (Order Service - Ebraheem)', 'Checks supplier eligibility with the Supplier Service; live EGP preview from the Evaluation Service');
  await selectByText('#o-supplier', 'Giza Steel Works');
  await slowType('#order-form input[name=description]', 'Steel beams HEB 200');
  await slowType('#order-form input[name=quantity]', '40');
  await slowType('#order-form input[name=unitPrice]', '120');
  await page.select('#order-form select[name=currency]', 'USD');
  await setValue('#order-form input[name=expectedDate]', day(14));
  await pause(3500);
  await caption('Main scenario 4/7 - Order above 50,000 EGP', 'Business rule: large orders wait for Admin approval; the order must also fit in the remaining contract value');
  await page.click('#order-form button[type=submit]');
  await pause(4500);
  const order = (await apiGet('order', '/api/orders?search=HEB')).orders[0];

  mark('approve');
  await login(ADMIN, 'Main scenario 5/7 - Admin approves the order');
  await go(`${SITE}/orders.html?id=${order.id}`);
  await caption('Main scenario 5/7 - Admin approves the order', 'PATCH /api/orders/:id/approval - Admin only, and nobody can approve an order they raised themselves');
  await pause(2500);
  dialogAnswers.push('Budget confirmed by procurement');
  await clickText('#order-detail', 'Approve');
  await pause(4000);

  mark('deliver');
  await login(OMAR, 'Main scenario 6/7 - Staff marks the order delivered');
  await go(`${SITE}/orders.html?id=${order.id}`);
  await caption('Main scenario 6/7 - Delivery workflow', 'APPROVED -> DELIVERED; the service calculates on-time / days late against the expected date');
  await pause(2000);
  dialogAnswers.push(day(0));
  await clickText('#order-detail', 'Mark delivered');
  await pause(4500);

  mark('rate');
  await go(`${SITE}/evaluations.html?orderId=${order.id}`);
  await caption('Main scenario 7/7 - Staff rates the delivered order (Evaluation Service - Karim)', 'Evaluation asks the Order Service: is it DELIVERED and yours? Overall = 0.4 x quality + 0.3 x price + 0.3 x delivery');
  await pause(1500);
  await page.select('#rate-form select[name=quality]', '5');
  await page.select('#rate-form select[name=price]', '4');
  await page.select('#rate-form select[name=delivery]', '5');
  await slowType('#rate-form textarea[name=comment]', 'On time, certificates included.');
  await page.click('#rate-btn');
  await pause(4500);

  await go(`${SITE}/supplier.html?id=${giza.id}`);
  await caption('Result: the new score is pushed to the Supplier Service', 'Supplier profile now shows the performance report from the Evaluation Service');
  await pause(5500);

  // ---------------------------------------------------------------- security scenarios
  mark('security: wrong password');
  await go(`${SITE}/index.html`);
  await page.evaluate(() => sessionStorage.clear());
  await go(`${SITE}/index.html`);
  await caption('Security 1/6 - Login with a wrong password', 'Same message for an unknown e-mail or a wrong password (no account enumeration); every failure is logged');
  await slowType('input[name=email]', SARA.email);
  await slowType('input[name=password]', 'not-my-password1');
  await page.click('#login-btn');
  await pause(4000);

  mark('security: role 403');
  await login(SARA, 'Security 2/6 - Staff opens the Admin area');
  await go(`${SITE}/admin.html`);
  const r403 = await page.evaluate(async () => { try { await api.get('auth', '/api/users'); return 'allowed'; } catch (e) { return `${e.status} ${e.code}: ${e.message}`; } });
  await page.evaluate((txt) => { document.querySelector('main').append(Object.assign(document.createElement('pre'), { className: 'error-box', textContent: 'Direct API call GET /api/users with the Staff token -> ' + txt })); }, r403);
  await caption('Security 2/6 - Unauthorized role', 'Hiding the page is not the control: the backend itself answers 403 FORBIDDEN to a Staff token');
  await pause(5000);

  mark('security: IDOR');
  await go(`${SITE}/orders.html?id=${order.id}`);
  await caption('Security 3/6 - Ownership check (IDOR)', "Sara opens Omar's order by changing the id in the URL: the backend answers 404, the order is not revealed");
  await scrollTo('#order-detail');
  await pause(5000);

  mark('security: business rule');
  await go(`${SITE}/orders.html`);
  const sz = (await apiGet('supplier', '/api/suppliers?search=Shenzhen')).suppliers[0];
  await page.evaluate((id) => {
    const s = document.getElementById('o-supplier'); s.append(new Option('Shenzhen Components Ltd (under review)', id)); s.value = id;
    const f = document.getElementById('order-form');
    f.description.value = 'Voltage regulators'; f.quantity.value = '100'; f.unitPrice.value = '3'; f.currency.value = 'CNY';
    f.expectedDate.value = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  }, sz.id);
  await caption('Security 4/6 - Business rule enforced by the backend', 'Shenzhen was put UNDER REVIEW automatically after 3 poor ratings: the Order Service refuses new orders (422)');
  await pause(1500);
  await page.click('#order-form button[type=submit]');
  await page.waitForSelector('#order-error:not([hidden])');
  await scrollTo('#order-form');
  await pause(4500);

  mark('security: invalid input');
  await go(`${SITE}/evaluations.html`);
  await page.evaluate(() => {
    const s = document.querySelector('#rate-form select[name=quality]'); s.append(new Option('9 (tampered in DevTools)', '9')); s.value = '9';
    const o = document.getElementById('r-order'); o.append(new Option('PO (tampered)', '00000000-0000-4000-8000-000000000000')); o.value = '00000000-0000-4000-8000-000000000000';
  });
  await caption('Security 5/6 - Invalid input', 'A tampered score of 9 is rejected by the backend validation with 400 and a clear message');
  await page.click('#rate-btn');
  await page.waitForSelector('#rate-error:not([hidden])');
  await scrollTo('#rate-form');
  await pause(4500);

  mark('security: lockout');
  await go(`${SITE}/index.html`);
  await page.evaluate(() => sessionStorage.clear());
  await go(`${SITE}/index.html`);
  await caption('Security 6/6 - Password guessing', '5 wrong passwords lock the account for 15 minutes (429), even the correct password is then refused');
  await slowType('input[name=email]', SARA.email);
  for (let i = 1; i <= 5; i++) {
    await page.type('input[name=password]', `guess-${i}-password`, { delay: 15 });
    await page.click('#login-btn');
    await pause(900);
  }
  await page.type('input[name=password]', SARA.pw, { delay: 15 });
  await page.click('#login-btn');
  await pause(4000);

  // ---------------------------------------------------------------- monitoring + cloud resources
  mark('monitoring page');
  await login(ADMIN, 'Monitoring - Admin security page');
  await go(`${SITE}/admin.html`);
  await caption('Monitoring - security events from all services (audit log)', 'Failed logins, account lock-outs, 403 role denials, ownership denials - counted per day, alert rule: 5+ in 15 minutes');
  await pause(6000);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
  await pause(4000);

  mark('floci dash');
  const dash = async (p, t, s, ms = 6000) => { await go(DASH + p); await caption(t, s); await pause(ms); };
  await dash('/cloud-explorer/aws/serverless', 'Floci - AWS Lambda', 'One function per service: ses-supplier-service (Zeyad), ses-order-service (Ebraheem), ses-evaluation-service (Karim), ses-auth-service (shared)');
  await page.setContent(apiHtml, { waitUntil: 'load' });
  await caption('Floci - Amazon API Gateway (live AWS CLI output)', 'One HTTP API per service -> its Lambda; only the listed routes are published, /internal/* gets 404 from the gateway');
  await pause(7000);
  await dash('/secretsmanager', 'Floci - AWS Secrets Manager', 'One secret per service (DB role password, JWT secrets, API key); each Lambda role can read only its own secret', 5000);
  await dash('/cloud-explorer/aws/logs', 'Floci - Amazon CloudWatch Logs', 'JSON log line per request and security event; never passwords, tokens or request bodies', 5000);
  await dash('/cloud-explorer/aws/cloudwatch', 'Floci - CloudWatch alarms', 'Metric filter FailedLogins -> alarm ses-repeated-failed-logins is in ALARM after the repeated failed logins', 7000);

  await go(`${SITE}/index.html`);
  await caption('End of demo - Supplier Directory & Evaluation System - Group 26', 'Zeyad: Supplier Service  |  Ebraheem: Order Service  |  Karim: Evaluation Service');
  await pause(4000);
  mark('end');
  await rec.stop();
  await browser.close();

  const ff = path.join(FFDIR, 'ffmpeg.exe');
  execFileSync(ff, ['-v', 'error', '-y', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', OUT]);
  fs.unlinkSync(webm);
  const dur = execFileSync(path.join(FFDIR, 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT], { encoding: 'utf8' }).trim();
  console.log(`video: ${OUT}  duration ${Number(dur).toFixed(1)} s  size ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB  alarm now: ${alarmState()}`);
})().catch((e) => { console.error(e); process.exit(1); });

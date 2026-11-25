// Resilience tests for the external integration and the cross-service conversion (proposal 3.4
// "External API cases"). Extra service instances are started with a broken dependency on purpose:
//   - an Evaluation Service whose ExchangeRate provider is unreachable / returns garbage
//   - an Order Service whose Evaluation Service is unreachable
// Requires the local stack (npm run local) and demo data (npm run seed:demo).

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require(path.join(__dirname, '..', 'services', 'node_modules', 'pg'));
const { parseEnv, LOCAL_ENV, ROOT } = require('../scripts/lib/env');
const lib = require('./lib');

const env = parseEnv(LOCAL_ENV);
const dbUrl = (role, pwVar) => `postgres://${role}:${encodeURIComponent(env[pwVar])}@localhost:${env.PG_PORT}/supplierdb`;
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const K = 'Karim (Evaluation)'; const E = 'Ebraheem (Order)';

function startService(name, port, extra) {
  const child = spawn(process.execPath, [path.join(ROOT, 'services', name, 'server.js')], {
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: 'test', SERVICE_NAME: name, PORT: String(port),
      JWT_SECRET: env.JWT_SECRET, INTERNAL_JWT_SECRET: env.INTERNAL_JWT_SECRET, SERVICE_TRANSPORT: 'http',
      SUPPLIER_SERVICE_URL: 'http://localhost:4002', ORDER_SERVICE_URL: 'http://localhost:4003', EVALUATION_SERVICE_URL: 'http://localhost:4004',
      LOG_FILE: path.join(ROOT, 'logs', `${name}-resilience.log`), ...extra,
    },
    stdio: 'ignore',
  });
  return new Promise((resolve) => {
    const t = setInterval(async () => {
      try { const r = await fetch(`http://localhost:${port}/api/health`); if (r.ok) { clearInterval(t); resolve(child); } } catch (_) { /* starting */ }
    }, 200);
  });
}

async function main() {
  const login = async (email, password) => (await lib.http('auth', 'POST', '/api/auth/login', { body: { email, password } })).body.token;
  const staff = await login('sara.hassan@ses.local', env.DEMO_STAFF_PASSWORD);
  const admin = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const delta = (await lib.http('supplier', 'GET', '/api/suppliers?search=Delta', { token: admin })).body.suppliers[0];

  // fake provider that answers with an invalid body
  const fake = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"result":"error","error-type":"quota-reached"}'); });
  await new Promise((r) => fake.listen(4099, r));

  const evalDown = await startService('evaluation-service', 4014, { DATABASE_URL: dbUrl('evaluation_svc', 'EVALUATION_DB_PASSWORD'), EXCHANGE_API_BASE_URL: 'http://127.0.0.1:9/v6', RATE_CACHE_HOURS: '0' });
  const evalBad = await startService('evaluation-service', 4015, { DATABASE_URL: dbUrl('evaluation_svc', 'EVALUATION_DB_PASSWORD'), EXCHANGE_API_BASE_URL: 'http://127.0.0.1:4099/v6', RATE_CACHE_HOURS: '0' });
  const orderNoEval = await startService('order-service', 4013, { DATABASE_URL: dbUrl('order_svc', 'ORDER_DB_PASSWORD'), EVALUATION_SERVICE_URL: 'http://127.0.0.1:9' });

  try {
    await lib.test({ id: 'RS-01', owner: K, category: 'External API', scenario: 'ExchangeRate provider unreachable, recent cached rate exists', expected: '200 with stale=true (cached rate used)' }, async () => {
      const r = await lib.http('http://localhost:4014', 'GET', '/api/rates/EUR', { token: staff });
      return lib.expectStatus(r, 200, r.body.stale === true && r.body.rateToEgp > 0);
    });
    await lib.test({ id: 'RS-02', owner: K, category: 'External API', scenario: 'Provider returns an invalid response (result=error)', expected: 'response rejected, cached rate used (stale=true)' }, async () => {
      const r = await lib.http('http://localhost:4015', 'GET', '/api/rates/USD', { token: staff });
      return lib.expectStatus(r, 200, r.body.stale === true);
    });
    await lib.test({ id: 'RS-03', owner: K, category: 'External API', scenario: 'Provider down and cached rate older than 7 days', expected: '502 RATE_UNAVAILABLE' }, async () => {
      const c = new Client({ connectionString: dbUrl('evaluation_svc', 'EVALUATION_DB_PASSWORD') });
      await c.connect();
      await c.query(`UPDATE evaluation.rate_cache SET fetched_at = now() - interval '8 days'`);
      try {
        return lib.expectStatus(await lib.http('http://localhost:4014', 'GET', '/api/rates/GBP', { token: staff }), 502);
      } finally {
        await c.query(`UPDATE evaluation.rate_cache SET fetched_at = now()`);
        await c.end();
      }
    });
    let pending;
    await lib.test({ id: 'RS-04', owner: E, category: 'Integration', scenario: 'Evaluation Service unreachable while a USD order is created', expected: '201, order saved with conversionStatus PENDING and PENDING_APPROVAL' }, async () => {
      const r = await lib.http('http://localhost:4013', 'POST', '/api/orders', { token: staff, body: { supplierId: delta.id, description: 'Resilience test film', quantity: 1, unitPrice: 20, currency: 'USD', expectedDate: day(7) } });
      pending = r.body && r.body.order;
      return lib.expectStatus(r, 201, pending && pending.conversionStatus === 'PENDING' && pending.status === 'PENDING_APPROVAL');
    });
    await lib.test({ id: 'RS-05', owner: E, category: 'Integration', scenario: 'Retry the conversion once the Evaluation Service is back', expected: '200, conversionStatus CONVERTED, amountEgp set' }, async () => {
      const r = await lib.http('order', 'POST', `/api/orders/${pending.id}/convert`, { token: staff });
      const ok = r.status === 200 && r.body.order.conversionStatus === 'CONVERTED' && r.body.order.amountEgp > 0;
      await lib.http('order', 'PATCH', `/api/orders/${pending.id}/status`, { token: staff, body: { status: 'CANCELLED', note: 'resilience test clean-up' } });
      return { ...lib.expectStatus(r, 200, ok) };
    });
    await lib.test({ id: 'RS-06', owner: 'Shared', category: 'Monitoring', scenario: 'External API failures are recorded as security/ops events', expected: 'EXTERNAL_API_FAILURE events visible to the Admin activity API' }, async () => {
      const r = await lib.http('auth', 'GET', '/api/admin/activity?days=1', { token: admin });
      const n = (r.body.totals.find((t) => t.event_type === 'EXTERNAL_API_FAILURE') || { count: 0 }).count;
      return { pass: r.status === 200 && n >= 2, actual: `${n} EXTERNAL_API_FAILURE event(s) today`, evidence: lib.redact(r.body.totals) };
    });
  } finally {
    [evalDown, evalBad, orderNoEval].forEach((c) => c.kill());
    fake.close();
  }
  const out = lib.writeReports('resilience-results', 'Resilience tests (external API and service outages)');
  process.exit(out.passed === out.total ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });

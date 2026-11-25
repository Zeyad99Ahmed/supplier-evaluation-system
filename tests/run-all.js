// Functional, integration and security tests against the running system (npm run local first).
//   node tests/run-all.js            -> evidence/test-results.{json,md}
// Point AUTH_API / SUPPLIER_API / ORDER_API / EVALUATION_API at the Floci API Gateway URLs to run the same
// tests against the deployed system (the DB-role and in-process tests need local access and are skipped).

const crypto = require('crypto');
const path = require('path');
const { execFileSync } = require('child_process');
const jwt = require(path.join(__dirname, '..', 'services', 'node_modules', 'jsonwebtoken'));
const { Client } = require(path.join(__dirname, '..', 'services', 'node_modules', 'pg'));
const { parseEnv, LOCAL_ENV } = require('../scripts/lib/env');
const { http, test, expectStatus, writeReports, redact } = require('./lib');

const env = { ...parseEnv(LOCAL_ENV), ...process.env };
const LOCAL = !process.env.AUTH_API;
const RUN = crypto.randomBytes(3).toString('hex');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const Z = 'Zeyad (Supplier)'; const E = 'Ebraheem (Order)'; const K = 'Karim (Evaluation)'; const S = 'Shared (Auth/Security)';

async function login(email, password) {
  const r = await http('auth', 'POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status}`);
  return r.body.token;
}

async function main() {
  const ctx = {};
  // ------------------------------------------------------------------ setup
  ctx.admin = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const pw = 'Test' + crypto.randomInt(1e6, 9e6) + 'pass';
  for (const who of ['a', 'b']) {
    const r = await http('auth', 'POST', '/api/users', { token: ctx.admin, body: { email: `t-${who}-${RUN}@ses.local`, fullName: `Tester ${who.toUpperCase()} ${RUN}`, password: pw } });
    ctx[`user_${who}`] = r.body.user;
    ctx[who] = await login(`t-${who}-${RUN}@ses.local`, pw);
  }
  const cats = (await http('supplier', 'GET', '/api/categories', { token: ctx.admin })).body.categories;
  const catId = cats.find((c) => c.name === 'Electronics').id;
  const catOther = cats.find((c) => c.name === 'IT Services').id;

  // ================================================================== AUTH (shared)
  await test({ id: 'AU-01', owner: S, category: 'Functional', scenario: 'Admin logs in with valid credentials', expected: '200 + token, no password hash in response' }, async () => {
    const r = await http('auth', 'POST', '/api/auth/login', { body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } });
    return expectStatus(r, 200, Boolean(r.body.token) && !r.text.includes('scrypt$') && !('passwordHash' in r.body.user));
  });
  await test({ id: 'AU-02', owner: S, category: 'Invalid input', scenario: 'Login with wrong password vs unknown e-mail', expected: 'both 401 with the same message' }, async () => {
    const r1 = await http('auth', 'POST', '/api/auth/login', { body: { email: `t-b-${RUN}@ses.local`, password: 'WrongPass123' } });
    const r2 = await http('auth', 'POST', '/api/auth/login', { body: { email: `nobody-${RUN}@ses.local`, password: 'WrongPass123' } });
    return { pass: r1.status === 401 && r2.status === 401 && r1.body.error.message === r2.body.error.message, actual: `${r1.status} / ${r2.status}, same message: ${r1.body.error.message === r2.body.error.message}`, evidence: redact(r1.body) };
  });
  await test({ id: 'AU-03', owner: S, category: 'Invalid input', scenario: 'Admin creates Staff with a weak password', expected: '400 VALIDATION_ERROR' }, async () =>
    expectStatus(await http('auth', 'POST', '/api/users', { token: ctx.admin, body: { email: `weak-${RUN}@ses.local`, fullName: 'Weak', password: 'short' } }), 400));
  await test({ id: 'AU-04', owner: S, category: 'Invalid input', scenario: 'Admin creates a Staff account with an e-mail that exists', expected: '409 EMAIL_TAKEN' }, async () =>
    expectStatus(await http('auth', 'POST', '/api/users', { token: ctx.admin, body: { email: `t-a-${RUN}@ses.local`, fullName: 'Dup', password: pw } }), 409));

  // ================================================================== SUPPLIER (Zeyad)
  let sup; let sup2;
  await test({ id: 'SU-01', owner: Z, category: 'Functional', scenario: 'Admin creates a supplier profile with a first contact', expected: '201, status ACTIVE' }, async () => {
    const r = await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: `Test Supplier ${RUN}`, categoryId: catId, email: `s-${RUN}@example.com`, phone: '+20 2 1111 2222', contact: { name: 'Contact Person', email: `c-${RUN}@example.com` } } });
    sup = r.body && r.body.supplier;
    return expectStatus(r, 201, sup && sup.status === 'ACTIVE');
  });
  await test({ id: 'SU-02', owner: Z, category: 'Invalid input', scenario: 'Create supplier with missing name, bad e-mail and unknown category', expected: '400 with 3 field errors' }, async () => {
    const r = await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { categoryId: 'abc', email: 'not-an-email' } });
    return expectStatus(r, 400, r.body.error.details.length >= 3);
  });
  await test({ id: 'SU-03', owner: Z, category: 'Business rule', scenario: 'Create a second supplier with the same name (any case)', expected: '409 SUPPLIER_EXISTS' }, async () =>
    expectStatus(await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: `TEST SUPPLIER ${RUN}`, categoryId: catId, email: `x-${RUN}@example.com` } }), 409));
  await test({ id: 'SU-04', owner: Z, category: 'Functional', scenario: 'Staff searches suppliers by category and text', expected: '200, the new supplier is found' }, async () => {
    const r = await http('supplier', 'GET', `/api/suppliers?categoryId=${catId}&search=${RUN}`, { token: ctx.a });
    return expectStatus(r, 200, r.body.suppliers.some((s) => s.id === sup.id));
  });
  await test({ id: 'SU-05', owner: Z, category: 'Functional', scenario: 'Admin updates supplier details (PUT)', expected: '200, new phone stored' }, async () => {
    const r = await http('supplier', 'PUT', `/api/suppliers/${sup.id}`, { token: ctx.admin, body: { name: `Test Supplier ${RUN}`, categoryId: catId, email: `s-${RUN}@example.com`, phone: '+20 2 9999 0000', country: 'Egypt' } });
    return expectStatus(r, 200, r.body.supplier.phone === '+20 2 9999 0000');
  });
  await test({ id: 'SU-06', owner: Z, category: 'Integration', scenario: 'Order for a supplier with NO contract (Order -> Supplier eligibility)', expected: '422 NO_ACTIVE_CONTRACT' }, async () => {
    const r = await http('order', 'POST', '/api/orders', { token: ctx.a, body: { supplierId: sup.id, description: 'Cables', quantity: 1, unitPrice: 100, currency: 'EGP', expectedDate: day(5) } });
    return expectStatus(r, 422, r.body.error.code === 'NO_ACTIVE_CONTRACT');
  });
  let contract;
  await test({ id: 'SU-07', owner: Z, category: 'Integration', scenario: 'Admin adds a USD contract; value converted to EGP by the Evaluation Service', expected: '201, valueEgp > value, rate stored' }, async () => {
    const r = await http('supplier', 'POST', `/api/suppliers/${sup.id}/contracts`, { token: ctx.admin, body: { title: 'Test framework', startDate: day(-30), endDate: day(300), value: 2000, currency: 'USD' } });
    contract = r.body && r.body.contract;
    return expectStatus(r, 201, contract && contract.valueEgp > contract.value && contract.rateToEgp > 1);
  });
  await test({ id: 'SU-08', owner: Z, category: 'Business rule', scenario: 'Add an overlapping active contract', expected: '409 CONTRACT_OVERLAP' }, async () =>
    expectStatus(await http('supplier', 'POST', `/api/suppliers/${sup.id}/contracts`, { token: ctx.admin, body: { title: 'Overlap', startDate: day(10), endDate: day(400), value: 10, currency: 'EGP' } }), 409));
  await test({ id: 'SU-09', owner: Z, category: 'Invalid input', scenario: 'Contract with end date before start date and unknown currency', expected: '400 VALIDATION_ERROR' }, async () =>
    expectStatus(await http('supplier', 'POST', `/api/suppliers/${sup.id}/contracts`, { token: ctx.admin, body: { title: 'Bad', startDate: day(10), endDate: day(1), value: 10, currency: 'XYZ' } }), 400));
  await test({ id: 'SU-10', owner: Z, category: 'Business rule', scenario: 'Invalid status transition ACTIVE -> ACTIVE', expected: '409 INVALID_STATUS_TRANSITION' }, async () =>
    expectStatus(await http('supplier', 'PATCH', `/api/suppliers/${sup.id}/status`, { token: ctx.admin, body: { status: 'ACTIVE', reason: 'No change really' } }), 409));
  await test({ id: 'SU-11', owner: Z, category: 'Functional', scenario: 'Recommendations for the category include the eligible supplier', expected: '200, supplier ranked' }, async () => {
    const r = await http('supplier', 'GET', `/api/suppliers/recommendations?categoryId=${catId}`, { token: ctx.a });
    return expectStatus(r, 200, r.body.recommendations.some((x) => x.id === sup.id));
  });

  // second supplier in another category, EGP contract with a small value (for limit tests)
  sup2 = (await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: `Limit Supplier ${RUN}`, categoryId: catOther, email: `l-${RUN}@example.com` } })).body.supplier;
  await http('supplier', 'POST', `/api/suppliers/${sup2.id}/contracts`, { token: ctx.admin, body: { title: 'Small contract', startDate: day(-10), endDate: day(100), value: 10000, currency: 'EGP' } });

  // ================================================================== ORDER (Ebraheem)
  let oA; let oBig;
  await test({ id: 'OR-01', owner: E, category: 'Integration', scenario: 'Staff A orders in USD (Order -> Supplier eligibility, Order -> Evaluation conversion)', expected: '201, APPROVED, amountEgp computed' }, async () => {
    const r = await http('order', 'POST', '/api/orders', { token: ctx.a, body: { supplierId: sup.id, description: 'Network switches', quantity: 2, unitPrice: 150, currency: 'USD', orderDate: day(-3), expectedDate: day(-1) } });
    oA = r.body && r.body.order;
    return expectStatus(r, 201, oA && oA.status === 'APPROVED' && oA.conversionStatus === 'CONVERTED' && oA.amountEgp > 300);
  });
  await test({ id: 'OR-02', owner: E, category: 'Business rule', scenario: 'Order above the approval threshold', expected: '201, PENDING_APPROVAL' }, async () => {
    const r = await http('order', 'POST', '/api/orders', { token: ctx.a, body: { supplierId: sup.id, description: 'Servers', quantity: 1, unitPrice: 1500, currency: 'USD', expectedDate: day(20) } });
    oBig = r.body && r.body.order;
    return expectStatus(r, 201, oBig && oBig.status === 'PENDING_APPROVAL');
  });
  await test({ id: 'OR-03', owner: E, category: 'Business rule', scenario: 'Order larger than the remaining contract value (10,000 EGP)', expected: '422 CONTRACT_LIMIT_EXCEEDED' }, async () => {
    const r = await http('order', 'POST', '/api/orders', { token: ctx.a, body: { supplierId: sup2.id, description: 'Licences', quantity: 3, unitPrice: 4000, currency: 'EGP', expectedDate: day(5) } });
    return expectStatus(r, 422, r.body.error.code === 'CONTRACT_LIMIT_EXCEEDED');
  });
  await test({ id: 'OR-04', owner: E, category: 'Invalid input', scenario: 'Order with quantity 0, expected date before order date, bad currency', expected: '400 VALIDATION_ERROR' }, async () =>
    expectStatus(await http('order', 'POST', '/api/orders', { token: ctx.a, body: { supplierId: sup.id, description: 'X', quantity: 0, unitPrice: -5, currency: 'ABC', expectedDate: 'tomorrow' } }), 400));
  await test({ id: 'OR-05', owner: E, category: 'Business rule', scenario: 'Mark a PENDING_APPROVAL order as delivered', expected: '409 INVALID_STATUS_TRANSITION' }, async () =>
    expectStatus(await http('order', 'PATCH', `/api/orders/${oBig.id}/status`, { token: ctx.a, body: { status: 'DELIVERED' } }), 409));
  await test({ id: 'OR-06', owner: E, category: 'Functional', scenario: 'Admin approves a Staff order', expected: '200, APPROVED' }, async () => {
    const r = await http('order', 'PATCH', `/api/orders/${oBig.id}/approval`, { token: ctx.admin, body: { decision: 'APPROVE', note: 'ok' } });
    return expectStatus(r, 200, r.body.order.status === 'APPROVED');
  });
  await test({ id: 'OR-07', owner: E, category: 'Functional', scenario: 'Staff marks order delivered 1 day late', expected: '200, DELIVERED, onTime=false, daysLate=1' }, async () => {
    const r = await http('order', 'PATCH', `/api/orders/${oA.id}/status`, { token: ctx.a, body: { status: 'DELIVERED', deliveredDate: day(0) } });
    return expectStatus(r, 200, r.body.order.status === 'DELIVERED' && r.body.order.onTime === false && r.body.order.daysLate === 1);
  });
  await test({ id: 'OR-08', owner: E, category: 'Business rule', scenario: 'Cancel an order that is already delivered', expected: '409' }, async () =>
    expectStatus(await http('order', 'PATCH', `/api/orders/${oA.id}/status`, { token: ctx.a, body: { status: 'CANCELLED' } }), 409));
  await test({ id: 'OR-09', owner: E, category: 'Functional', scenario: 'Staff A lists orders filtered by supplier (only own orders returned)', expected: '200, 2 orders, all created by A' }, async () => {
    const r = await http('order', 'GET', `/api/orders?supplierId=${sup.id}`, { token: ctx.a });
    return expectStatus(r, 200, r.body.total === 2 && r.body.orders.every((o) => o.createdBy === ctx.user_a.id));
  });
  await test({ id: 'OR-10', owner: E, category: 'Functional', scenario: 'Spending summary calculates totals per supplier', expected: '200, supplier spend = sum of its order EGP values' }, async () => {
    const r = await http('order', 'GET', '/api/orders/summary', { token: ctx.a });
    const row = r.body.bySupplier.find((x) => x.supplierId === sup.id);
    const expected = Math.round((oA.amountEgp + oBig.amountEgp) * 100) / 100;
    return expectStatus(r, 200, row && Math.abs(row.spendEgp - expected) < 0.02);
  });

  // ================================================================== EVALUATION (Karim)
  let evA;
  await test({ id: 'EV-01', owner: K, category: 'Integration', scenario: 'Rate an order that is not delivered (Evaluation -> Order status check)', expected: '409 ORDER_NOT_DELIVERED' }, async () =>
    expectStatus(await http('evaluation', 'POST', '/api/evaluations', { token: ctx.a, body: { orderId: oBig.id, quality: 4, price: 4, delivery: 4 } }), 409));
  await test({ id: 'EV-02', owner: K, category: 'Functional', scenario: 'Staff A rates the delivered order (4,3,5)', expected: '201, overall 0.4*4+0.3*3+0.3*5 = 4.00, supplier score pushed' }, async () => {
    const r = await http('evaluation', 'POST', '/api/evaluations', { token: ctx.a, body: { orderId: oA.id, quality: 4, price: 3, delivery: 5, comment: 'Late by a day but good.' } });
    evA = r.body && r.body.evaluation;
    return expectStatus(r, 201, evA && evA.overall === 4 && r.body.supplierPerformance.synced === true);
  });
  await test({ id: 'EV-03', owner: K, category: 'Business rule', scenario: 'Rate the same order a second time', expected: '409 ALREADY_RATED' }, async () =>
    expectStatus(await http('evaluation', 'POST', '/api/evaluations', { token: ctx.a, body: { orderId: oA.id, quality: 5, price: 5, delivery: 5 } }), 409));
  await test({ id: 'EV-04', owner: K, category: 'Invalid input', scenario: 'Rating with quality 9 and price "abc"', expected: '400 VALIDATION_ERROR' }, async () =>
    expectStatus(await http('evaluation', 'POST', '/api/evaluations', { token: ctx.a, body: { orderId: oA.id, quality: 9, price: 'abc', delivery: 3 } }), 400));
  await test({ id: 'EV-05', owner: K, category: 'Functional', scenario: 'Author edits their rating', expected: '200, overall recalculated (5,5,5 -> 5.00)' }, async () => {
    const r = await http('evaluation', 'PUT', `/api/evaluations/${evA.id}`, { token: ctx.a, body: { quality: 5, price: 5, delivery: 5, comment: 'Updated' } });
    return expectStatus(r, 200, r.body.evaluation.overall === 5);
  });
  await test({ id: 'EV-06', owner: K, category: 'Integration', scenario: 'Supplier profile shows the score pushed by the Evaluation Service', expected: 'avgScore 5, ratingCount 1, onTimeRate 0' }, async () => {
    const r = await http('supplier', 'GET', `/api/suppliers/${sup.id}`, { token: ctx.b });
    const p = r.body.supplier.performance;
    return { pass: p.avgScore === 5 && p.ratingCount === 1 && p.onTimeRate === 0, actual: JSON.stringify(p), evidence: redact(p) };
  });
  await test({ id: 'EV-07', owner: K, category: 'Functional', scenario: 'Performance report and comparison', expected: '200, report averages match, compare ranks 2 suppliers' }, async () => {
    const r = await http('evaluation', 'GET', `/api/performance/suppliers/${sup.id}`, { token: ctx.b });
    const c = await http('evaluation', 'GET', `/api/performance/compare?supplierIds=${sup.id},${sup2.id}`, { token: ctx.b });
    return { pass: r.status === 200 && r.body.report.averages.overall === 5 && c.status === 200 && c.body.ranking[0].supplierId === sup.id, actual: `${r.status}/${c.status}`, evidence: redact(c.body.ranking) };
  });
  await test({ id: 'EV-08', owner: K, category: 'External API', scenario: 'GET /api/rates/USD from ExchangeRate API (cached)', expected: '200, rateToEgp > 0, rate date' }, async () => {
    const r = await http('evaluation', 'GET', '/api/rates/USD', { token: ctx.b });
    return expectStatus(r, 200, r.body.rateToEgp > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.body.rateDate));
  });
  await test({ id: 'EV-09', owner: K, category: 'Invalid input', scenario: 'Rate lookup for an unsupported currency', expected: '400 VALIDATION_ERROR' }, async () =>
    expectStatus(await http('evaluation', 'GET', '/api/rates/XYZ', { token: ctx.b }), 400));
  await test({ id: 'EV-10', owner: K, category: 'Functional', scenario: 'Author deletes their rating; supplier count drops back to 0', expected: '200, ratingCount 0' }, async () => {
    const r = await http('evaluation', 'DELETE', `/api/evaluations/${evA.id}`, { token: ctx.a });
    return expectStatus(r, 200, r.body.supplierPerformance.ratingCount === 0);
  });

  // ================================================================== Cross-service workflow: automatic review
  await test({ id: 'IN-01', owner: 'All three', category: 'Integration', scenario: '3 poor ratings put the supplier UNDER_REVIEW, then new orders are refused', expected: 'statusChanged=true, then order 422 SUPPLIER_UNDER_REVIEW' }, async () => {
    let changed = false;
    for (let i = 0; i < 3; i++) {
      const o = (await http('order', 'POST', '/api/orders', { token: ctx.b, body: { supplierId: sup2.id, description: `Item ${i}`, quantity: 1, unitPrice: 100, currency: 'EGP', expectedDate: day(0) } })).body.order;
      await http('order', 'PATCH', `/api/orders/${o.id}/status`, { token: ctx.b, body: { status: 'DELIVERED' } });
      const ev = await http('evaluation', 'POST', '/api/evaluations', { token: ctx.b, body: { orderId: o.id, quality: 1, price: 2, delivery: 2 } });
      if (ev.body.supplierPerformance.supplierStatusChanged) changed = true;
    }
    const r = await http('order', 'POST', '/api/orders', { token: ctx.b, body: { supplierId: sup2.id, description: 'Blocked', quantity: 1, unitPrice: 10, currency: 'EGP', expectedDate: day(3) } });
    return { pass: changed && r.status === 422 && r.body.error.code === 'SUPPLIER_UNDER_REVIEW', actual: `statusChanged=${changed}, order ${r.status} ${r.body.error && r.body.error.code}`, evidence: redact(r.body) };
  });
  await test({ id: 'IN-02', owner: 'Zeyad + Ebraheem', category: 'Integration', scenario: 'Archive a supplier with an open order (Supplier -> Order open-order check)', expected: '409 SUPPLIER_HAS_OPEN_ORDERS' }, async () => {
    await http('order', 'POST', '/api/orders', { token: ctx.a, body: { supplierId: sup.id, description: 'Open order', quantity: 1, unitPrice: 10, currency: 'EGP', expectedDate: day(3) } });
    return expectStatus(await http('supplier', 'DELETE', `/api/suppliers/${sup.id}`, { token: ctx.admin }), 409);
  });
  await test({ id: 'IN-03', owner: 'Zeyad', category: 'Integration', scenario: 'Archive a supplier with no open orders', expected: '200, status ARCHIVED, contracts terminated' }, async () => {
    const s3 = (await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: `Archive Me ${RUN}`, categoryId: catOther, email: `ar-${RUN}@example.com` } })).body.supplier;
    const r = await http('supplier', 'DELETE', `/api/suppliers/${s3.id}`, { token: ctx.admin });
    const g = await http('supplier', 'GET', `/api/suppliers/${s3.id}`, { token: ctx.admin });
    return expectStatus(r, 200, g.body.supplier.status === 'ARCHIVED');
  });

  // ================================================================== SECURITY
  const SEC = (id, scenario, expected, fn, category = 'Security') => test({ id, owner: S, category, scenario, expected }, fn);

  await SEC('SEC-01', 'Unauthenticated requests to protected routes of all four services', '401 from every service', async () => {
    const rs = await Promise.all([http('auth', 'GET', '/api/auth/me'), http('supplier', 'GET', '/api/suppliers'), http('order', 'GET', '/api/orders'), http('evaluation', 'GET', '/api/evaluations')]);
    return { pass: rs.every((r) => r.status === 401), actual: rs.map((r) => r.status).join(', '), evidence: redact(rs[1].body) };
  }, 'Unauthenticated access');
  if (env.JWT_SECRET) { // needs the signing secret (local .env.local or infra/.env.floci)
    await SEC('SEC-02', 'Forged JWT (signed with a wrong secret) and expired JWT', '401 for both', async () => {
      const forged = jwt.sign({ sub: ctx.user_a.id, role: 'admin' }, 'not-the-secret', { issuer: 'ses-auth-service', audience: 'ses-app' });
      const expired = jwt.sign({ sub: ctx.user_a.id, role: 'staff', sid: 'x', exp: Math.floor(Date.now() / 1000) - 60 }, env.JWT_SECRET, { issuer: 'ses-auth-service', audience: 'ses-app' });
      const r1 = await http('supplier', 'POST', '/api/suppliers', { token: forged, body: { name: 'Hacker', categoryId: 1, email: 'h@x.com' } });
      const r2 = await http('order', 'GET', '/api/orders', { token: expired });
      return { pass: r1.status === 401 && r2.status === 401, actual: `${r1.status}, ${r2.status}`, evidence: redact(r1.body) };
    }, 'Unauthenticated access');
  }
  await SEC('SEC-03', 'Staff tries Admin actions: create supplier, approve order, list users, view security log', '403 for each', async () => {
    const rs = await Promise.all([
      http('supplier', 'POST', '/api/suppliers', { token: ctx.a, body: { name: 'Staff Supplier', categoryId: catId, email: 'x@y.com' } }),
      http('order', 'PATCH', `/api/orders/${oBig.id}/approval`, { token: ctx.b, body: { decision: 'APPROVE' } }),
      http('auth', 'GET', '/api/users', { token: ctx.a }),
      http('auth', 'GET', '/api/admin/activity', { token: ctx.a }),
    ]);
    return { pass: rs.every((r) => r.status === 403), actual: rs.map((r) => r.status).join(', '), evidence: redact(rs[0].body) };
  }, 'Unauthorized role');
  await SEC('SEC-04', 'Admin tries to submit a rating (only Staff may rate)', '403', async () =>
    expectStatus(await http('evaluation', 'POST', '/api/evaluations', { token: ctx.admin, body: { orderId: oA.id, quality: 5, price: 5, delivery: 5 } }), 403), 'Unauthorized role');
  await SEC('SEC-05', 'Privilege escalation: create a user with role "admin" in the body', '400 (role cannot be set by the client)', async () =>
    expectStatus(await http('auth', 'POST', '/api/users', { token: ctx.admin, body: { email: `esc-${RUN}@ses.local`, fullName: 'Escalate', password: pw, role: 'admin' } }), 400), 'Unauthorized role');
  await SEC('SEC-06', 'IDOR: Staff B reads / changes / cancels Staff A\'s order by id', '404 for each (existence not revealed)', async () => {
    const rs = await Promise.all([
      http('order', 'GET', `/api/orders/${oBig.id}`, { token: ctx.b }),
      http('order', 'PATCH', `/api/orders/${oBig.id}/status`, { token: ctx.b, body: { status: 'CANCELLED' } }),
      http('order', 'POST', `/api/orders/${oBig.id}/convert`, { token: ctx.b }),
    ]);
    return { pass: rs.every((r) => r.status === 404), actual: rs.map((r) => r.status).join(', '), evidence: redact(rs[0].body) };
  }, 'Ownership / access');
  await SEC('SEC-07', 'IDOR: Staff A rates Staff B\'s delivered order, and edits B\'s rating', '404 for both', async () => {
    const bOrders = (await http('order', 'GET', '/api/orders?status=DELIVERED', { token: ctx.b })).body.orders;
    const bEval = (await http('evaluation', 'GET', '/api/evaluations?mine=true', { token: ctx.b })).body.evaluations[0];
    const o = (await http('order', 'POST', '/api/orders', { token: ctx.b, body: { supplierId: sup.id, description: 'B order', quantity: 1, unitPrice: 5, currency: 'EGP', expectedDate: day(1) } })).body.order;
    await http('order', 'PATCH', `/api/orders/${o.id}/status`, { token: ctx.b, body: { status: 'DELIVERED' } });
    const r1 = await http('evaluation', 'POST', '/api/evaluations', { token: ctx.a, body: { orderId: o.id, quality: 1, price: 1, delivery: 1 } });
    const r2 = await http('evaluation', 'PUT', `/api/evaluations/${bEval.id}`, { token: ctx.a, body: { quality: 5, price: 5, delivery: 5 } });
    return { pass: r1.status === 404 && r2.status === 404 && bOrders.length > 0, actual: `${r1.status}, ${r2.status}`, evidence: redact(r1.body) };
  }, 'Ownership / access');
  await SEC('SEC-08', 'Segregation of duties: Admin approves an order they raised themselves', '403 SELF_APPROVAL_NOT_ALLOWED', async () => {
    // own supplier + large EGP contract so only the approval rule is exercised
    const s4 = (await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: `SoD Supplier ${RUN}`, categoryId: catOther, email: `sod-${RUN}@example.com` } })).body.supplier;
    await http('supplier', 'POST', `/api/suppliers/${s4.id}/contracts`, { token: ctx.admin, body: { title: 'Large', startDate: day(-5), endDate: day(200), value: 5000000, currency: 'EGP' } });
    const o = (await http('order', 'POST', '/api/orders', { token: ctx.admin, body: { supplierId: s4.id, description: 'Admin big order', quantity: 1, unitPrice: 90000, currency: 'EGP', expectedDate: day(9) } })).body.order;
    if (o.status !== 'PENDING_APPROVAL') throw new Error('setup: order not pending approval');
    return expectStatus(await http('order', 'PATCH', `/api/orders/${o.id}/approval`, { token: ctx.admin, body: { decision: 'APPROVE' } }), 403);
  }, 'Unauthorized role');
  await SEC('SEC-09', 'Malformed input: invalid JSON, text/plain body, 200 KB body', '400, 415, 413', async () => {
    const r1 = await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, raw: '{"name": "x",', headers: { 'content-type': 'application/json' } });
    const r2 = await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, raw: 'name=x', headers: { 'content-type': 'text/plain' } });
    const r3 = await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: 'x'.repeat(200000) } });
    return { pass: r1.status === 400 && r2.status === 415 && r3.status === 413, actual: `${r1.status}, ${r2.status}, ${r3.status}`, evidence: redact(r2.body) };
  }, 'Invalid input');
  await SEC('SEC-10', 'SQL injection in the supplier search and order filter', '200 with no extra rows / 400, never 500', async () => {
    const r1 = await http('supplier', 'GET', `/api/suppliers?search=${encodeURIComponent("' OR 1=1 --")}`, { token: ctx.a });
    const r2 = await http('order', 'GET', `/api/orders?status=${encodeURIComponent("APPROVED' OR '1'='1")}`, { token: ctx.a });
    return { pass: r1.status === 200 && r1.body.total === 0 && r2.status === 400, actual: `${r1.status} (total ${r1.body.total}), ${r2.status}`, evidence: redact(r1.body) };
  }, 'Invalid input');
  await SEC('SEC-11', 'Stored XSS payload in a supplier name is stored as plain text (UI uses textContent + CSP)', '201, value returned unchanged, never executed', async () => {
    const payload = `<img src=x onerror=alert(1)> ${RUN}`;
    const r = await http('supplier', 'POST', '/api/suppliers', { token: ctx.admin, body: { name: payload, categoryId: catOther, email: `xss-${RUN}@example.com` } });
    return expectStatus(r, 201, r.body.supplier.name === payload);
  }, 'Invalid input');
  await SEC('SEC-12', 'Brute force: 5 wrong passwords lock the account; correct password then refused', '401 x5, then 429 ACCOUNT_LOCKED', async () => {
    const email = `t-lock-${RUN}@ses.local`; // fresh account so earlier tests do not count
    await http('auth', 'POST', '/api/users', { token: ctx.admin, body: { email, fullName: 'Lockout Tester', password: pw } });
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await http('auth', 'POST', '/api/auth/login', { body: { email, password: 'Wrong' + i + 'password' } })).status);
    const r = await http('auth', 'POST', '/api/auth/login', { body: { email, password: pw } });
    return { pass: codes.every((c) => c === 401) && r.status === 429, actual: `${codes.join(',')} then ${r.status}`, evidence: redact(r.body) };
  }, 'Identity');
  await SEC('SEC-13', 'Logout revokes the session; disabled account cannot log in', '/me 401 after logout; login 401 when disabled', async () => {
    const t = await login(`t-a-${RUN}@ses.local`, pw);
    await http('auth', 'POST', '/api/auth/logout', { token: t });
    const me = await http('auth', 'GET', '/api/auth/me', { token: t });
    await http('auth', 'PATCH', `/api/users/${ctx.user_a.id}/status`, { token: ctx.admin, body: { isActive: false } });
    const l = await http('auth', 'POST', '/api/auth/login', { body: { email: `t-a-${RUN}@ses.local`, password: pw } });
    await http('auth', 'PATCH', `/api/users/${ctx.user_a.id}/status`, { token: ctx.admin, body: { isActive: true } });
    return { pass: me.status === 401 && l.status === 401, actual: `me ${me.status}, login ${l.status}`, evidence: redact(me.body) };
  }, 'Identity');
  if (LOCAL) {
    await SEC('SEC-14', 'Internal routes: no service token, and a token from a caller that is not allowed', '401, then 403', async () => {
      const r1 = await http('order', 'GET', `/internal/orders/${oA.id}`);
      const wrong = jwt.sign({ sub: 'supplier-service' }, env.INTERNAL_JWT_SECRET, { issuer: 'ses-internal', audience: 'order-service', expiresIn: '60s' });
      const r2 = await http('order', 'GET', `/internal/orders/${oA.id}`, { headers: { 'x-service-token': wrong } });
      return { pass: r1.status === 401 && r2.status === 403, actual: `${r1.status}, ${r2.status}`, evidence: redact(r2.body) };
    }, 'Cloud / service config');
  }
  if (env.ORDER_DB_PASSWORD) { // needs network access to the database (local or the Floci Postgres container)
    await SEC('SEC-15', 'Database least privilege: order_svc reads the supplier schema and deletes an order', 'permission denied for both', async () => {
      const u = new URL(`postgres://order_svc:${encodeURIComponent(env.ORDER_DB_PASSWORD)}@localhost:${env.PG_PORT}/supplierdb`);
      const c = new Client({ connectionString: u.toString() });
      await c.connect();
      const msgs = [];
      for (const sql of ['SELECT count(*) FROM supplier.suppliers', 'DELETE FROM orders.purchase_orders', 'SELECT * FROM audit.activity_log LIMIT 1', 'DROP TABLE orders.purchase_orders']) {
        try { await c.query(sql); msgs.push('ALLOWED'); } catch (e) { msgs.push(e.code); }
      }
      await c.end();
      return { pass: msgs.every((m) => m === '42501'), actual: msgs.join(', ') + ' (42501 = insufficient_privilege)', evidence: msgs.join(', ') };
    }, 'Cloud / service config');
  }
  await SEC('SEC-16', 'CORS: browser pre-flight from an unknown origin vs the website origin', 'no Allow-Origin for evil.example; allowed for the site', async () => {
    const evil = await http('order', 'OPTIONS', '/api/orders', { headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } });
    const good = await http('order', 'OPTIONS', '/api/orders', { headers: { origin: process.env.SITE_ORIGIN || 'http://localhost:8080', 'access-control-request-method': 'POST' } });
    const e = evil.headers.get('access-control-allow-origin'); const g = good.headers.get('access-control-allow-origin');
    return { pass: !e && Boolean(g), actual: `evil: ${e || 'none'}, site: ${g}`, evidence: `evil ${evil.status} ACAO=${e || 'none'}; site ${good.status} ACAO=${g}` };
  }, 'Cloud / service config');
  await SEC('SEC-17', 'Security headers on API responses', 'nosniff, HSTS, frame protection, no X-Powered-By', async () => {
    const r = await http('supplier', 'GET', '/api/health');
    const h = (k) => r.headers.get(k);
    const ok = h('x-content-type-options') === 'nosniff' && Boolean(h('strict-transport-security')) && Boolean(h('x-frame-options')) && !h('x-powered-by');
    return { pass: ok, actual: `nosniff=${h('x-content-type-options')}, hsts=${Boolean(h('strict-transport-security'))}, xfo=${h('x-frame-options')}, powered-by=${h('x-powered-by') || 'none'}`, evidence: `content-security-policy: ${h('content-security-policy')}` };
  }, 'Cloud / service config');
  if (LOCAL) {
    await SEC('SEC-18', 'Secret exposure review: repository scan + logs contain no passwords/tokens', '0 findings in repo, 0 secrets in logs', async () => {
      let scan;
      try { scan = execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'secret-scan.js')], { encoding: 'utf8' }); } catch (e) { scan = e.stdout || e.message; }
      const fs = require('fs');
      const logDir = path.join(__dirname, '..', 'logs');
      const logs = fs.readdirSync(logDir).map((f) => fs.readFileSync(path.join(logDir, f), 'utf8')).join('\n');
      const leaks = [env.ADMIN_PASSWORD, env.JWT_SECRET, env.INTERNAL_JWT_SECRET, pw].filter((s) => s && logs.includes(s)).length + (logs.match(/eyJhbGci/g) || []).length;
      const clean = /0 finding/.test(scan);
      return { pass: clean && leaks === 0, actual: `${scan.trim().split('\n').pop()}; secrets/tokens found in logs: ${leaks}`, evidence: scan.trim().split('\n').pop() };
    }, 'Secret exposure');
  }

  return writeReports(LOCAL ? 'test-results' : 'test-results-deployed', LOCAL ? 'Functional, integration and security tests (local run)' : 'Tests against the deployed system');
}

main().then((r) => process.exit(r.passed === r.total ? 0 : 1)).catch((e) => { console.error(e); process.exit(2); });

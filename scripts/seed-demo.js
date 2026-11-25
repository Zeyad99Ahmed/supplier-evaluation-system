// Seeds realistic demo data THROUGH THE REAL APIs (so every business rule and service call runs).
// Usage: node scripts/seed-demo.js [--base-auth URL --base-supplier URL --base-order URL --base-evaluation URL]
// Default URLs are the local ones; for Floci pass the API Gateway URLs (infra/floci-urls.env).
// Demo staff passwords are generated once and stored in the git-ignored .env.local (DEMO_STAFF_PASSWORD).

const fs = require('fs');
const crypto = require('crypto');
const { parseEnv, LOCAL_ENV } = require('./lib/env');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const B = {
  auth: arg('--base-auth', process.env.AUTH_API || 'http://localhost:4001'),
  supplier: arg('--base-supplier', process.env.SUPPLIER_API || 'http://localhost:4002'),
  order: arg('--base-order', process.env.ORDER_API || 'http://localhost:4003'),
  evaluation: arg('--base-evaluation', process.env.EVALUATION_API || 'http://localhost:4004'),
};

const env = { ...parseEnv(LOCAL_ENV), ...process.env };
if (!env.DEMO_STAFF_PASSWORD) {
  env.DEMO_STAFF_PASSWORD = 'Staff' + crypto.randomInt(100000, 999999) + 'demo';
  fs.appendFileSync(LOCAL_ENV, `DEMO_STAFF_PASSWORD=${env.DEMO_STAFF_PASSWORD}\n`);
}

async function call(svc, method, path, body, token, okStatuses = [200, 201]) {
  const res = await fetch(B[svc] + path, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!okStatuses.includes(res.status)) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const login = async (email, password) => (await call('auth', 'POST', '/api/auth/login', { email, password })).token;

async function main() {
  const admin = await login(env.ADMIN_EMAIL, env.ADMIN_PASSWORD);
  const staff = [
    { email: 'sara.hassan@ses.local', fullName: 'Sara Hassan' },
    { email: 'omar.khaled@ses.local', fullName: 'Omar Khaled' },
  ];
  for (const s of staff) await call('auth', 'POST', '/api/users', { ...s, password: env.DEMO_STAFF_PASSWORD }, admin, [201, 409]);
  const [sara, omar] = await Promise.all(staff.map((s) => login(s.email, env.DEMO_STAFF_PASSWORD)));

  const cats = Object.fromEntries((await call('supplier', 'GET', '/api/categories', null, admin)).categories.map((c) => [c.name, c.id]));
  const existing = (await call('supplier', 'GET', '/api/suppliers?limit=100', null, admin)).suppliers;
  if (existing.length) { console.log('Suppliers already exist - demo data was seeded before. Nothing to do.'); return; }

  const specs = [
    { name: 'Nile Electronics', cat: 'Electronics', email: 'sales@nile-electronics.example', phone: '+20 2 2345 6789', country: 'Egypt', address: 'Smart Village, Giza',
      contact: { name: 'Mona Adel', jobTitle: 'Account Manager', email: 'mona@nile-electronics.example' },
      contract: { title: 'Laptops & accessories 2026', startDate: '2026-01-01', endDate: '2027-06-30', value: 2000000, currency: 'EGP' } },
    { name: 'Delta Packaging Co.', cat: 'Packaging', email: 'orders@delta-pack.example', phone: '+20 40 333 1234', country: 'Egypt', address: 'Tanta Industrial Zone',
      contact: { name: 'Hany Fawzy', jobTitle: 'Sales Lead', email: 'hany@delta-pack.example' },
      contract: { title: 'Cartons and pallets framework', startDate: '2026-03-01', endDate: '2027-02-28', value: 40000, currency: 'USD' } },
    { name: 'Cairo Office Mart', cat: 'Office Supplies', email: 'b2b@cairo-office.example', phone: '+20 2 2555 0101', country: 'Egypt', address: 'Nasr City, Cairo',
      contract: { title: 'Stationery supply', startDate: '2026-01-15', endDate: '2027-01-14', value: 300000, currency: 'EGP' } },
    { name: 'Shenzhen Components Ltd', cat: 'Electronics', email: 'export@sz-components.example', phone: '+86 755 1234 5678', country: 'China', address: 'Shenzhen, Guangdong',
      contact: { name: 'Li Wei', jobTitle: 'Export Manager', email: 'li.wei@sz-components.example' },
      contract: { title: 'PCB components', startDate: '2026-02-01', endDate: '2027-01-31', value: 500000, currency: 'CNY' } },
    { name: 'EuroFreight Logistics GmbH', cat: 'Logistics', email: 'cairo@eurofreight.example', phone: '+49 40 1234 567', country: 'Germany', address: 'Hamburg',
      contract: { title: 'Sea freight Hamburg-Alexandria', startDate: '2026-04-01', endDate: '2027-03-31', value: 60000, currency: 'EUR' } },
    { name: 'Alexandria Raw Materials', cat: 'Raw Materials', email: 'info@alex-raw.example', phone: '+20 3 480 1122', country: 'Egypt', address: 'Alexandria Port' },
  ];
  const sup = {};
  for (const s of specs) {
    const { supplier } = await call('supplier', 'POST', '/api/suppliers', {
      name: s.name, categoryId: cats[s.cat], email: s.email, phone: s.phone, country: s.country, address: s.address, contact: s.contact,
    }, admin);
    sup[s.name] = supplier.id;
    if (s.contract) await call('supplier', 'POST', `/api/suppliers/${supplier.id}/contracts`, s.contract, admin);
    console.log('supplier', s.name);
  }

  // orders: [token, supplier, description, qty, unitPrice, currency, orderDaysAgo, expectedDaysAgo, deliveredDaysAgo|null, rating|null]
  const plan = [
    [sara, 'Nile Electronics', 'Business laptops 14"', 5, 32000, 'EGP', 28, 20, 21, [5, 4, 5, 'Delivered early, well packed.']],
    [omar, 'Nile Electronics', 'USB-C docking stations', 12, 3500, 'EGP', 25, 15, 14, [4, 4, 4, 'Good quality.']],
    [sara, 'Delta Packaging Co.', 'Double-wall cartons (1000 pcs)', 2, 450, 'USD', 26, 18, 16, [4, 3, 4, 'Fine, price a bit high.']],
    [omar, 'Cairo Office Mart', 'A4 paper boxes', 40, 310, 'EGP', 20, 12, 12, [3, 5, 4, null]],
    [sara, 'Shenzhen Components Ltd', 'Power regulator ICs', 2000, 4.5, 'CNY', 29, 15, 9, [2, 3, 1, 'Six days late, 3% defective.']],
    [omar, 'Shenzhen Components Ltd', 'Capacitor kits', 500, 12, 'CNY', 27, 14, 6, [2, 2, 2, 'Late again and poor packaging.']],
    [sara, 'Shenzhen Components Ltd', 'LED driver boards', 300, 25, 'CNY', 24, 12, 3, [3, 2, 1, 'Very late.']],
    [omar, 'EuroFreight Logistics GmbH', 'Container freight (2 x 40ft)', 2, 1850, 'EUR', 22, 10, 11, [4, 3, 5, null]],
    [sara, 'Nile Electronics', '27" monitors', 10, 9800, 'EGP', 5, -10, null, null],          // > threshold -> waits for approval
    [omar, 'Delta Packaging Co.', 'Stretch film rolls', 50, 9, 'USD', 3, -7, null, null],     // approved, open
    [sara, 'Cairo Office Mart', 'Printer toner cartridges', 30, 2400, 'EGP', 2, -6, null, null], // > threshold
  ];
  const created = [];
  for (const [tok, s, desc, qty, price, cur, od, ed, dd, rating] of plan) {
    const { order } = await call('order', 'POST', '/api/orders', {
      supplierId: sup[s], description: desc, quantity: qty, unitPrice: price, currency: cur, orderDate: daysAgo(od), expectedDate: daysAgo(ed),
    }, tok);
    created.push(order);
    if (order.status === 'PENDING_APPROVAL' && dd !== null) {
      await call('order', 'PATCH', `/api/orders/${order.id}/approval`, { decision: 'APPROVE', note: 'Budget confirmed.' }, admin);
    }
    if (dd !== null) await call('order', 'PATCH', `/api/orders/${order.id}/status`, { status: 'DELIVERED', deliveredDate: daysAgo(dd) }, tok);
    if (rating) await call('evaluation', 'POST', '/api/evaluations', { orderId: order.id, quality: rating[0], price: rating[1], delivery: rating[2], comment: rating[3] || undefined }, tok);
    console.log('order', order.orderNumber, s, order.status);
  }
  // one rejected order for the history
  const big = created.find((o) => o.description === 'Printer toner cartridges');
  if (big && big.status === 'PENDING_APPROVAL') await call('order', 'PATCH', `/api/orders/${big.id}/approval`, { decision: 'REJECT', note: 'Use the existing toner stock first.' }, admin);
  console.log(`\nDemo data ready. Staff logins: ${staff.map((s) => s.email).join(', ')} (password = DEMO_STAFF_PASSWORD in .env.local)`);
}

main().catch((e) => { console.error('Seeding failed:', e.message); process.exit(1); });

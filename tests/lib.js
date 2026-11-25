// Tiny test harness: records every test with its id, owner, scenario, expected and actual result, and
// evidence (HTTP status + a trimmed response). Results are written to evidence/ as JSON and Markdown.
const fs = require('fs');
const path = require('path');

const results = [];
const BASE = {
  auth: process.env.AUTH_API || 'http://localhost:4001',
  supplier: process.env.SUPPLIER_API || 'http://localhost:4002',
  order: process.env.ORDER_API || 'http://localhost:4003',
  evaluation: process.env.EVALUATION_API || 'http://localhost:4004',
};

async function http(svc, method, p, { body, token, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  let payload;
  if (raw !== undefined) payload = raw;
  else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = h['content-type'] || 'application/json'; }
  const res = await fetch((BASE[svc] || svc) + p, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
  return { status: res.status, body: json, text, headers: res.headers };
}

// Redact anything token-like before it becomes evidence.
function redact(v) {
  return JSON.stringify(v, (k, val) => (['token', 'password', 'password_hash'].includes(k) ? '[REDACTED]' : val)).slice(0, 260);
}

async function test(meta, fn) {
  const r = { ...meta, actual: '', pass: false, evidence: '' };
  try {
    const out = await fn();
    r.actual = out.actual; r.pass = Boolean(out.pass); r.evidence = out.evidence || '';
  } catch (e) {
    r.actual = 'Test error: ' + e.message; r.pass = false;
  }
  results.push(r);
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(8)} ${r.scenario}${r.pass ? '' : '  -> ' + r.actual}`);
  return r;
}

// helper for the common "expect status X" case
const expectStatus = (res, expected, extra = true) => ({
  pass: (Array.isArray(expected) ? expected.includes(res.status) : res.status === expected) && extra,
  actual: `${res.status}${res.body && res.body.error ? ' ' + res.body.error.code : ''}`,
  evidence: `HTTP ${res.status} ${redact(res.body)}`,
});

function writeReports(name, title) {
  const dir = path.join(__dirname, '..', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  const passed = results.filter((r) => r.pass).length;
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify({ runAt: new Date().toISOString(), passed, failed: results.length - passed, results }, null, 2));
  const md = [`# ${title}`, '', `Run at ${new Date().toISOString()} - **${passed}/${results.length} passed**`, '',
    '| ID | Owner | Category | Scenario | Expected | Actual | Result | Evidence |', '|---|---|---|---|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.owner || ''} | ${r.category || ''} | ${r.scenario} | ${r.expected} | ${String(r.actual).replace(/\|/g, '/')} | ${r.pass ? 'PASS' : 'FAIL'} | \`${String(r.evidence).replace(/\|/g, '/').replace(/`/g, "'")}\` |`)].join('\n');
  fs.writeFileSync(path.join(dir, `${name}.md`), md + '\n');
  console.log(`\n${passed}/${results.length} passed. Written evidence/${name}.json and .md`);
  return { passed, total: results.length };
}

module.exports = { http, test, expectStatus, writeReports, results, redact, BASE };

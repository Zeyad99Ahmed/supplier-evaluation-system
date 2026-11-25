// Tests the PACKAGED Lambda functions (dist/*.zip) the way Floci/AWS runs them, without Docker:
//  - each zip is extracted and its handler (<service>/lambda.handler) is called with API Gateway v2 events;
//  - a small mock of the AWS APIs answers Secrets Manager GetSecretValue (secrets loaded at cold start)
//    and Lambda Invoke (so SERVICE_TRANSPORT=lambda service-to-service calls really run through the AWS SDK);
//  - every invocation runs in its own Node process with only that function's environment variables.
// Requires: npm run local (database) + node scripts/package-lambda.js all.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');
const { parseEnv, LOCAL_ENV, ROOT } = require('../scripts/lib/env');
const lib = require('./lib');

const env = parseEnv(LOCAL_ENV);
const MOCK_PORT = Number(process.env.MOCK_AWS_PORT || 4599); // not 4566, so it can run while Floci is up
const SVCS = { 'auth-service': ['auth_svc', 'AUTH_DB_PASSWORD'], 'supplier-service': ['supplier_svc', 'SUPPLIER_DB_PASSWORD'], 'order-service': ['order_svc', 'ORDER_DB_PASSWORD'], 'evaluation-service': ['evaluation_svc', 'EVALUATION_DB_PASSWORD'] };
const fnName = (svc) => `ses-${svc}`;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-lambda-'));
const calls = { secrets: [], invokes: [] };

// secrets that infra/deploy.sh would store in Secrets Manager (built from the local env file here)
const secretFor = (svc) => {
  const [role, pw] = SVCS[svc];
  const s = { DATABASE_URL: `postgres://${role}:${encodeURIComponent(env[pw])}@localhost:${env.PG_PORT}/supplierdb`, JWT_SECRET: env.JWT_SECRET, INTERNAL_JWT_SECRET: env.INTERNAL_JWT_SECRET };
  if (svc === 'evaluation-service' && env.EXCHANGE_API_KEY) s.EXCHANGE_API_KEY = env.EXCHANGE_API_KEY;
  return s;
};

function functionEnv(svc) {
  return {
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP,
    AWS_LAMBDA_FUNCTION_NAME: fnName(svc), AWS_REGION: 'us-east-1', AWS_ACCESS_KEY_ID: 'test', AWS_SECRET_ACCESS_KEY: 'test',
    AWS_ENDPOINT_URL: `http://localhost:${MOCK_PORT}`, // Floci injects this into Lambda containers
    SERVICE_NAME: svc, SECRET_ID: `ses/${svc}`, NODE_ENV: 'production', SERVICE_TRANSPORT: 'lambda',
    CORS_ORIGINS: 'http://localhost:4566',
    SUPPLIER_SERVICE_FUNCTION: fnName('supplier-service'), ORDER_SERVICE_FUNCTION: fnName('order-service'), EVALUATION_SERVICE_FUNCTION: fnName('evaluation-service'),
  };
}

// Runs one invocation of a packaged function in a fresh process (like a Lambda cold start).
function invoke(svc, event) {
  const dir = path.join(work, svc);
  const resultFile = path.join(work, `result-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const runner = `
    const fs = require('fs');
    const { handler } = require(${JSON.stringify(path.join(dir, svc, 'lambda.js'))});
    const event = JSON.parse(fs.readFileSync(0, 'utf8'));
    handler(event, { functionName: process.env.AWS_LAMBDA_FUNCTION_NAME, getRemainingTimeInMillis: () => 10000 })
      .then((r) => { fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(r)); process.exit(0); })
      .catch((e) => { fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ errorMessage: e.message })); process.exit(0); });`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', runner], { env: functionEnv(svc), stdio: ['pipe', 'ignore', 'inherit'] });
    child.stdin.end(JSON.stringify(event));
    child.on('exit', () => {
      try { resolve(JSON.parse(fs.readFileSync(resultFile, 'utf8'))); } catch (e) { reject(e); }
    });
  });
}

// Minimal mock of the two AWS APIs the functions use.
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const target = req.headers['x-amz-target'] || '';
    if (target === 'secretsmanager.GetSecretValue') {
      const { SecretId } = JSON.parse(body);
      calls.secrets.push(SecretId);
      const svc = SecretId.replace('ses/', '');
      if (!SVCS[svc]) { res.writeHead(400, { 'content-type': 'application/x-amz-json-1.1' }); return res.end(JSON.stringify({ __type: 'ResourceNotFoundException' })); }
      res.writeHead(200, { 'content-type': 'application/x-amz-json-1.1' });
      return res.end(JSON.stringify({ Name: SecretId, ARN: `arn:aws:secretsmanager:us-east-1:000000000000:secret:${SecretId}`, SecretString: JSON.stringify(secretFor(svc)) }));
    }
    const m = req.url.match(/^\/2015-03-31\/functions\/([^/]+)\/invocations/);
    if (m) {
      const fn = decodeURIComponent(m[1]);
      calls.invokes.push(fn);
      const svc = fn.replace('ses-', '');
      const out = await invoke(svc, JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json', 'x-amz-executed-version': '$LATEST' });
      return res.end(JSON.stringify(out));
    }
    res.writeHead(404); res.end();
  });
});

const ev = (method, rawPath, { token, body, query = '' } = {}) => ({
  version: '2.0', routeKey: `${method} ${rawPath}`, rawPath, rawQueryString: query,
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), origin: 'http://localhost:4566' },
  requestContext: { http: { method, path: rawPath, sourceIp: '203.0.113.10' }, requestId: 'test-' + Date.now() },
  isBase64Encoded: false, body: body ? JSON.stringify(body) : undefined,
});
const parse = (r) => ({ status: r.statusCode, body: r.body ? JSON.parse(r.isBase64Encoded ? Buffer.from(r.body, 'base64').toString() : r.body) : null, headers: r.headers || {} });

async function main() {
  for (const svc of Object.keys(SVCS)) {
    const zipPath = path.join(ROOT, 'dist', `${svc}.zip`);
    if (!fs.existsSync(zipPath)) throw new Error(`Missing ${zipPath} - run node scripts/package-lambda.js all`);
    new AdmZip(zipPath).extractAllTo(path.join(work, svc), true);
  }
  await new Promise((r) => mock.listen(MOCK_PORT, r));
  const L = 'Ebraheem (deployment lead)';
  try {
    await lib.test({ id: 'LT-01', owner: L, category: 'Deployment', scenario: 'Packaged supplier-service zip answers GET /api/health as a Lambda', expected: '200, runtime "lambda", database ok, secret loaded from Secrets Manager' }, async () => {
      const r = parse(await invoke('supplier-service', ev('GET', '/api/health')));
      return { pass: r.status === 200 && r.body.runtime === 'lambda' && r.body.database === 'ok' && calls.secrets.includes('ses/supplier-service'), actual: `${r.status} ${JSON.stringify(r.body)}`, evidence: JSON.stringify(r.body) };
    });
    let token;
    await lib.test({ id: 'LT-02', owner: L, category: 'Deployment', scenario: 'Login through the packaged auth-service handler', expected: '200 + token' }, async () => {
      const r = parse(await invoke('auth-service', ev('POST', '/api/auth/login', { body: { email: 'omar.khaled@ses.local', password: env.DEMO_STAFF_PASSWORD } })));
      token = r.body && r.body.token;
      return { pass: r.status === 200 && Boolean(token), actual: String(r.status), evidence: `HTTP ${r.status}, token issued: ${Boolean(token)}` };
    });
    await lib.test({ id: 'LT-03', owner: L, category: 'Deployment', scenario: 'Authenticated GET /api/orders through the order-service handler; CORS header for the S3 site', expected: '200, only own orders, Access-Control-Allow-Origin set' }, async () => {
      const r = parse(await invoke('order-service', ev('GET', '/api/orders', { token })));
      const acao = r.headers['access-control-allow-origin'];
      return { pass: r.status === 200 && r.body.orders.length > 0 && acao === 'http://localhost:4566', actual: `${r.status}, ${r.body.total} orders, ACAO=${acao}`, evidence: `HTTP ${r.status} total=${r.body.total}` };
    });
    await lib.test({ id: 'LT-04', owner: 'Zeyad + Ebraheem', category: 'Integration', scenario: 'Archive a supplier with open orders via Lambda: supplier-service calls order-service with lambda:InvokeFunction', expected: '409 SUPPLIER_HAS_OPEN_ORDERS and one Invoke of ses-order-service' }, async () => {
      const adminTok = parse(await invoke('auth-service', ev('POST', '/api/auth/login', { body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } }))).body.token;
      const list = parse(await invoke('supplier-service', ev('GET', '/api/suppliers', { token: adminTok, query: 'search=Delta' })));
      const before = calls.invokes.length;
      const r = parse(await invoke('supplier-service', ev('DELETE', `/api/suppliers/${list.body.suppliers[0].id}`, { token: adminTok })));
      const invoked = calls.invokes.slice(before);
      return { pass: r.status === 409 && r.body.error.code === 'SUPPLIER_HAS_OPEN_ORDERS' && invoked.includes('ses-order-service'), actual: `${r.status} ${r.body.error && r.body.error.code}; invoked: ${invoked.join(',')}`, evidence: JSON.stringify(r.body) };
    });
    await lib.test({ id: 'LT-05', owner: L, category: 'Security', scenario: 'Unauthenticated request and unknown route through the evaluation-service handler', expected: '401 and 404' }, async () => {
      const r1 = parse(await invoke('evaluation-service', ev('GET', '/api/evaluations')));
      const r2 = parse(await invoke('evaluation-service', ev('GET', '/api/does-not-exist')));
      return { pass: r1.status === 401 && r2.status === 404, actual: `${r1.status}, ${r2.status}`, evidence: JSON.stringify(r1.body) };
    });
    await lib.test({ id: 'LT-06', owner: L, category: 'Security', scenario: 'Each function requests only its own secret from Secrets Manager', expected: 'only ses/<own-service> secrets were requested' }, async () => {
      const own = calls.secrets.every((s) => /^ses\/(auth|supplier|order|evaluation)-service$/.test(s));
      return { pass: own, actual: `requested: ${[...new Set(calls.secrets)].join(', ')}`, evidence: [...new Set(calls.secrets)].join(', ') };
    });
  } finally {
    mock.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
  const out = lib.writeReports('lambda-results', 'Packaged Lambda function tests (mock AWS endpoint)');
  process.exit(out.passed === out.total ? 0 : 1);
}

main().catch((e) => { console.error(e); mock.close(); process.exit(2); });

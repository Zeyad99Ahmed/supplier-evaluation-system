// Runs the whole system on one PC for development and testing:
//   PostgreSQL (embedded, port 5433, data kept in .localdata/pg) -> db-setup -> 4 services -> website.
// Each service runs as its own process with its own database role and talks to the others over HTTP,
// exactly as the Lambda functions talk to each other on Floci (there via lambda:InvokeFunction).
//
//   npm run local            start everything (Ctrl+C stops it)
//   npm run local -- --reset delete the local database first
//
// Use DATABASE_ADMIN_URL=<owner url> (e.g. Neon) to skip the embedded Postgres.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { ensureLocalEnv, ROOT } = require('./lib/env');
const { setupDatabase } = require('./db-setup');
const { startStaticServer } = require('./static-server');

const SERVICES = [
  { name: 'auth-service', port: 4001, role: 'auth_svc', pw: 'AUTH_DB_PASSWORD' },
  { name: 'supplier-service', port: 4002, role: 'supplier_svc', pw: 'SUPPLIER_DB_PASSWORD' },
  { name: 'order-service', port: 4003, role: 'order_svc', pw: 'ORDER_DB_PASSWORD' },
  { name: 'evaluation-service', port: 4004, role: 'evaluation_svc', pw: 'EVALUATION_DB_PASSWORD' },
];
const WEB_PORT = 8080;

async function main() {
  const env = { ...ensureLocalEnv(), ...process.env };
  const children = [];
  let pg;

  if (!process.env.DATABASE_ADMIN_URL) {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    const dataDir = path.join(ROOT, '.localdata', 'pg');
    if (process.argv.includes('--reset') && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
    pg = new EmbeddedPostgres({
      databaseDir: dataDir, user: 'ses_owner', password: env.PG_SUPERUSER_PASSWORD, port: Number(env.PG_PORT), persistent: true,
      onLog: () => {}, onError: () => {},
    });
    if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) await pg.initialise();
    await pg.start();
    try { await pg.createDatabase('supplierdb'); } catch (_) { /* already exists */ }
    env.DATABASE_ADMIN_URL = `postgres://ses_owner:${encodeURIComponent(env.PG_SUPERUSER_PASSWORD)}@localhost:${env.PG_PORT}/supplierdb`;
    console.log(`PostgreSQL running on localhost:${env.PG_PORT} (database supplierdb)`);
  }
  await setupDatabase(env);
  const dbHost = new URL(env.DATABASE_ADMIN_URL);

  const common = {
    NODE_ENV: 'development',
    JWT_SECRET: env.JWT_SECRET,
    INTERNAL_JWT_SECRET: env.INTERNAL_JWT_SECRET,
    SERVICE_TRANSPORT: 'http',
    CORS_ORIGINS: `http://localhost:${WEB_PORT}`,
    AUTH_SERVICE_URL: 'http://localhost:4001',
    SUPPLIER_SERVICE_URL: 'http://localhost:4002',
    ORDER_SERVICE_URL: 'http://localhost:4003',
    EVALUATION_SERVICE_URL: 'http://localhost:4004',
    APPROVAL_THRESHOLD_EGP: env.APPROVAL_THRESHOLD_EGP || '50000',
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
  };
  for (const k of ['EXCHANGE_API_KEY', 'EXCHANGE_API_BASE_URL', 'LOGIN_MAX_FAILED', 'LOGIN_LOCK_MINUTES', 'RATE_CACHE_HOURS', 'EDIT_WINDOW_DAYS']) {
    if (env[k]) common[k] = env[k];
  }

  fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
  for (const s of SERVICES) {
    const url = `postgres://${s.role}:${encodeURIComponent(env[s.pw])}@${dbHost.host}${dbHost.pathname}${dbHost.search}`;
    const child = spawn(process.execPath, [path.join(ROOT, 'services', s.name, 'server.js')], {
      env: { ...common, SERVICE_NAME: s.name, PORT: String(s.port), DATABASE_URL: url, LOG_FILE: path.join(ROOT, 'logs', `${s.name}.log`) },
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('exit', (code) => { if (code) console.error(`${s.name} exited with code ${code}`); });
    children.push(child);
  }
  const web = await startStaticServer(path.join(ROOT, 'frontend'), WEB_PORT);

  // wait for health
  for (const s of SERVICES) {
    for (let i = 0; i < 40; i++) {
      try { const r = await fetch(`http://localhost:${s.port}/api/health`); if (r.ok) break; } catch (_) { /* starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  console.log('\nServices:');
  SERVICES.forEach((s) => console.log(`  ${s.name.padEnd(19)} http://localhost:${s.port}/api/health  (DB role ${s.role})`));
  console.log(`  website             http://localhost:${WEB_PORT}/`);
  console.log(`\nFirst admin: ${env.ADMIN_EMAIL} (password is ADMIN_PASSWORD in .env.local)`);
  console.log('Logs: logs/<service>.log   - Ctrl+C to stop.\n');
  if (process.argv.includes('--ready-file')) fs.writeFileSync(path.join(ROOT, '.localdata', 'ready'), new Date().toISOString());

  const stop = async () => {
    children.forEach((c) => c.kill());
    web.close();
    if (pg) await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error('local-up failed:', e.message); process.exit(1); });

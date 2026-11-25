// Database setup (lead: Karim - shared task "Database setup").
// 1) creates one LOGIN role per service with its own password,
// 2) creates the schemas/tables, 3) grants least-privilege rights, 4) seeds categories and the first Admin.
//
// Usage:  DATABASE_ADMIN_URL=postgres://owner:...@host/db  node scripts/db-setup.js
//   (scripts/local-up.js calls it automatically; for Neon/Floci use the owner connection string.)
// Role passwords: AUTH_DB_PASSWORD, SUPPLIER_DB_PASSWORD, ORDER_DB_PASSWORD, EVALUATION_DB_PASSWORD.
// First admin: ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME (only used if no admin exists yet).

const fs = require('fs');
const path = require('path');
const { Client } = require(path.join(__dirname, '..', 'services', 'node_modules', 'pg'));
const { hashPassword } = require('../services/auth-service/src/passwords');

const ROLES = [
  ['auth_svc', 'AUTH_DB_PASSWORD'],
  ['supplier_svc', 'SUPPLIER_DB_PASSWORD'],
  ['order_svc', 'ORDER_DB_PASSWORD'],
  ['evaluation_svc', 'EVALUATION_DB_PASSWORD'],
];

async function setupDatabase(env = process.env, { quiet = false } = {}) {
  const log = (...a) => { if (!quiet) console.log(...a); };
  if (!env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is not set');
  const ssl = /sslmode=require|neon\.tech/.test(env.DATABASE_ADMIN_URL) ? { rejectUnauthorized: true } : undefined;
  const client = new Client({ connectionString: env.DATABASE_ADMIN_URL, ssl });
  await client.connect();
  try {
    for (const [role, pwVar] of ROLES) {
      const pw = env[pwVar];
      if (!pw || pw.length < 12) throw new Error(`${pwVar} must be set (12+ characters)`);
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      // format() quotes the identifier and the literal safely - the password is never concatenated by hand.
      const { rows } = await client.query(`SELECT format('${verb} ROLE %I WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L', $1::text, $2::text) AS sql`, [role, pw]);
      await client.query(rows[0].sql);
      log(`role ${role}: ${verb === 'CREATE' ? 'created' : 'password updated'}`);
    }
    const dbName = (await client.query('SELECT current_database() AS d')).rows[0].d;
    await client.query(`REVOKE CONNECT ON DATABASE ${client.escapeIdentifier(dbName)} FROM PUBLIC`);
    for (const [role] of ROLES) await client.query(`GRANT CONNECT ON DATABASE ${client.escapeIdentifier(dbName)} TO ${role}`);

    for (const file of ['01_schemas.sql', '02_roles_grants.sql', '03_seed.sql']) {
      await client.query(fs.readFileSync(path.join(__dirname, '..', 'database', file), 'utf8'));
      log(`applied database/${file}`);
    }

    const admins = await client.query(`SELECT count(*)::int AS n FROM auth.users WHERE role = 'admin'`);
    if (admins.rows[0].n === 0) {
      if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are needed to create the first admin');
      await client.query(`INSERT INTO auth.users (email, password_hash, full_name, role) VALUES (lower($1), $2, $3, 'admin')`,
        [env.ADMIN_EMAIL, await hashPassword(env.ADMIN_PASSWORD), env.ADMIN_NAME || 'Procurement Admin']);
      log(`first admin created: ${env.ADMIN_EMAIL}`);
    }
  } finally {
    await client.end();
  }
}

module.exports = { setupDatabase };

if (require.main === module) {
  setupDatabase().then(() => console.log('Database setup complete.')).catch((e) => { console.error('Database setup failed:', e.message); process.exit(1); });
}

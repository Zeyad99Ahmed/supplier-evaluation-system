// PostgreSQL access (Neon or the Postgres container next to Floci).
// Each service connects with its OWN database role (DATABASE_URL differs per service), and that role
// only has privileges on its own schema (see database/02_roles_grants.sql). A bug or injection in one
// service therefore cannot read or change another service's tables.
// All queries are parameterised ($1, $2...) - user input is never concatenated into SQL.

const { Pool, types } = require('pg');

// Return DATE columns as 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);

let pool;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    const needsTls = /sslmode=require/.test(url) || /neon\.tech/.test(url);
    pool = new Pool({
      connectionString: url,
      // Small pool: each Lambda instance handles one request at a time; keeps DB connections low (cost/limits).
      max: Number(process.env.DB_POOL_MAX || (process.env.AWS_LAMBDA_FUNCTION_NAME ? 2 : 5)),
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
      ssl: needsTls ? { rejectUnauthorized: true } : undefined,
    });
    pool.on('error', () => { /* idle client errors are logged by request handlers */ });
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);

async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function ping() {
  await query('SELECT 1');
  return true;
}

async function close() {
  if (pool) { await pool.end(); pool = undefined; }
}

module.exports = { query, withTransaction, ping, isConfigured, close };

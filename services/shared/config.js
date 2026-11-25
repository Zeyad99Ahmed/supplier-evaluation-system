// Configuration and secrets.
// Locally: values come from environment variables (scripts/local-up.js reads the git-ignored .env.local).
// On Lambda: SECRET_ID names this service's own secret in AWS Secrets Manager. It is read once per
// cold start with the function's IAM role (no access keys in code), and merged into process.env.
// Each service's role may only read its OWN secret (see infra/iam/*-policy.json).

let loaded = false;

async function loadSecrets() {
  if (loaded || !process.env.SECRET_ID) { loaded = true; return; }
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  const client = new SecretsManagerClient({});
  const out = await client.send(new GetSecretValueCommand({ SecretId: process.env.SECRET_ID }));
  const values = JSON.parse(out.SecretString || '{}');
  for (const [k, v] of Object.entries(values)) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = String(v);
  }
  loaded = true;
  const { logger } = require('./logger');
  logger.info('secrets_loaded', { secretId: process.env.SECRET_ID, keys: Object.keys(values) }); // names only, never values
}

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required setting ${name}`);
  return v;
}

const num = (name, def) => (process.env[name] ? Number(process.env[name]) : def);

module.exports = { loadSecrets, required, num };

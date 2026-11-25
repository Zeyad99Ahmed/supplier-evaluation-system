// Secret exposure review: scans every file that would be committed (respects .gitignore patterns for
// node_modules/.env/logs/.localdata) for things that look like credentials.
// Run before every commit:  node scripts/secret-scan.js     (exit code 1 if something is found)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.localdata', 'logs', 'dist', 'out', 'evidence']);
const SKIP_FILES = [/^\.env(\..*)?$/, /\.zip$/, /\.png$/, /\.jpg$/, /\.docx$/, /\.pdf$/];
const RULES = [
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Private key', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['Postgres URL with password', /postgres(?:ql)?:\/\/[^:\s'"`$<{]+:[^@\s'"`$<{]{6,}@(?!host)/i],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Hard-coded secret assignment', /\b(JWT_SECRET|INTERNAL_JWT_SECRET|EXCHANGE_API_KEY|DB_PASSWORD|ADMIN_PASSWORD)\s*[:=]\s*['"][^'"$]{8,}['"]/],
  ['ExchangeRate API key in URL', /exchangerate-api\.com\/v6\/[a-f0-9]{24}/i],
];
// Allowed on purpose: documented placeholders.
const ALLOW = [/CHANGE_ME/, /<your-/, /example\.com/, /USER:PASSWORD@HOST/];

const findings = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name)); continue; }
    if (SKIP_FILES.some((r) => r.test(entry.name))) continue;
    const file = path.join(dir, entry.name);
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      for (const [name, re] of RULES) {
        if (re.test(line) && !ALLOW.some((a) => a.test(line))) findings.push(`${path.relative(ROOT, file)}:${i + 1}  ${name}`);
      }
    });
  }
}
walk(ROOT);
findings.forEach((f) => console.log('FINDING ' + f));
console.log(`Secret scan: ${findings.length} finding(s) in tracked source files.`);
process.exit(findings.length ? 1 : 0);

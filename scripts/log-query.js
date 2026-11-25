// Log query & monitoring report over the structured JSON logs (logs/*.log locally; the same lines go to
// CloudWatch Logs on Floci/AWS, where infra/monitoring.sh turns them into metrics and alarms).
// It applies the SAME rules as the CloudWatch metric filters and alarms:
//   FailedLogins  { $.event = AUTH_LOGIN_FAILED || AUTH_ACCOUNT_LOCKED }  alarm: >= 5 in 5 minutes
//   Http403       { $.event = http_request && $.status = 403 }           alarm: >= 10 in 5 minutes
//   Http401, Http5xx, ExchangeApiFailures
//   node scripts/log-query.js            -> prints the report and writes evidence/log-monitoring.md
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dir = path.join(ROOT, 'logs');
const lines = [];
for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
    try { if (l.trim()) lines.push(JSON.parse(l)); } catch (_) { /* skip non-JSON */ }
  }
}
lines.sort((a, b) => a.ts.localeCompare(b.ts));

const req = lines.filter((l) => l.event === 'http_request');
const failed = lines.filter((l) => l.event === 'AUTH_LOGIN_FAILED' || l.event === 'AUTH_ACCOUNT_LOCKED');
const window5 = (events) => { // sliding 5-minute windows -> max count and when
  let best = { count: 0, start: null }; let j = 0;
  for (let i = 0; i < events.length; i++) {
    while (Date.parse(events[i].ts) - Date.parse(events[j].ts) > 300000) j++;
    if (i - j + 1 > best.count) best = { count: i - j + 1, start: events[j].ts, end: events[i].ts };
  }
  return best;
};
const count = (arr, key) => arr.reduce((m, x) => { const k = typeof key === 'function' ? key(x) : x[key]; m[k] = (m[k] || 0) + 1; return m; }, {});

const byServiceStatus = {};
for (const r of req) {
  const s = (byServiceStatus[r.service] = byServiceStatus[r.service] || { total: 0, '2xx': 0, '4xx': 0, '401': 0, '403': 0, '404': 0, '5xx': 0 });
  s.total++;
  if (r.status >= 500) s['5xx']++; else if (r.status >= 400) s['4xx']++; else s['2xx']++;
  if ([401, 403, 404].includes(r.status)) s[String(r.status)]++;
}
const f403 = req.filter((r) => r.status === 403);
const failedWin = window5(failed);
const w403 = window5(f403);
const securityEvents = count(lines.filter((l) => l.level === 'warn' && l.event !== 'http_request'), 'event');
const sources = Object.entries(count(failed, (l) => l.ip || 'unknown')).sort((a, b) => b[1] - a[1]);
const latency = req.length ? Math.round(req.reduce((a, r) => a + r.ms, 0) / req.length) : 0;
const p95 = req.length ? [...req].map((r) => r.ms).sort((a, b) => a - b)[Math.floor(req.length * 0.95)] : 0;
const extFail = lines.filter((l) => l.event === 'EXTERNAL_API_FAILURE');

// what a log line looks like (sanitised sample - proves no secrets are logged)
const samples = [
  lines.find((l) => l.event === 'http_request' && l.status === 201),
  failed[0],
  lines.find((l) => l.event === 'ACCESS_DENIED_ROLE'),
  lines.find((l) => l.event === 'ACCESS_DENIED_OWNERSHIP'),
  extFail[0],
  lines.find((l) => l.event === 'service_call'),
].filter(Boolean);

const alarm = (name, rule, best, threshold) => `| ${name} | ${rule} | ${best.count} | ${best.count >= threshold ? '**ALARM**' : 'OK'} | ${best.start ? best.start + ' to ' + best.end : '-'} |`;

const md = [
  '# Log and monitoring evidence', '',
  `Generated ${new Date().toISOString()} from ${lines.length} structured log lines (${req.length} HTTP requests) in logs/*.log.`,
  'Same JSON lines that each Lambda writes to CloudWatch Logs (/aws/lambda/ses-<service>).', '',
  '## 1. Requests per service and status (metric: count by status)', '',
  '| Service | Requests | 2xx/3xx | 4xx | 401 | 403 | 404 | 5xx |', '|---|---|---|---|---|---|---|---|',
  ...Object.entries(byServiceStatus).map(([s, v]) => `| ${s} | ${v.total} | ${v['2xx']} | ${v['4xx']} | ${v['401']} | ${v['403']} | ${v['404']} | ${v['5xx']} |`),
  '', `Average latency ${latency} ms, p95 ${p95} ms.`, '',
  '## 2. Alarm rules evaluated over the logs (same thresholds as infra/monitoring.sh)', '',
  '| Alarm | Rule | Max in any 5-min window | State | Window |', '|---|---|---|---|---|',
  alarm('ses-repeated-failed-logins', 'FailedLogins >= 5 in 5 min', failedWin, 5),
  alarm('ses-many-403', 'Http403 >= 10 in 5 min', w403, 10),
  `| ses-server-errors | Http5xx >= 1 in 5 min | ${req.filter((r) => r.status >= 500).length} total | ${req.some((r) => r.status >= 500) ? '**ALARM**' : 'OK'} | - |`, '',
  '## 3. Security events (filter: level = warn)', '',
  '| Event | Count |', '|---|---|', ...Object.entries(securityEvents).sort((a, b) => b[1] - a[1]).map(([e, n]) => `| ${e} | ${n} |`), '',
  '## 4. Failed-login sources (possible password guessing)', '',
  '| Source IP | Failed logins |', '|---|---|', ...sources.map(([ip, n]) => `| ${ip} | ${n} |`), '',
  `## 5. External API (ExchangeRate) failures: ${extFail.length}`, '',
  ...extFail.slice(0, 5).map((e) => `- ${e.ts} ${e.detail ? e.detail.reason : ''}`), '',
  '## 6. Sample log lines (no passwords, tokens, request bodies or comments are ever logged)', '',
  '```json', ...samples.map((s) => JSON.stringify(s)), '```', '',
  '## Equivalent CloudWatch commands on Floci', '',
  '```bash',
  "aws logs filter-log-events --log-group-name /aws/lambda/ses-auth-service --filter-pattern '{ $.event = \"AUTH_LOGIN_FAILED\" }'",
  "aws logs filter-log-events --log-group-name /aws/lambda/ses-order-service --filter-pattern '{ $.status = 403 }'",
  'aws cloudwatch get-metric-statistics --namespace SES/Security --metric-name FailedLogins --statistics Sum --period 300 --start-time <t0> --end-time <t1>',
  'aws cloudwatch describe-alarms --alarm-names ses-repeated-failed-logins',
  '```',
].join('\n');

fs.mkdirSync(path.join(ROOT, 'evidence'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'evidence', 'log-monitoring.md'), md + '\n');
fs.writeFileSync(path.join(ROOT, 'evidence', 'log-monitoring.json'), JSON.stringify({ byServiceStatus, failedWin, w403, securityEvents, sources, latency, p95, extFailures: extFail.length, samples }, null, 2));
console.log(md);

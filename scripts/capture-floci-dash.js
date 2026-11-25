// Captures Floci Dash (the AWS-console-like UI of Floci) pages as deployment evidence.
//   node scripts/capture-floci-dash.js [uiBase]      default http://localhost:4500
// Output: evidence/floci-dash/NN-name.png (no secret values are displayed on these pages).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const BASE = process.argv[2] || 'http://localhost:4500';
const OUT = path.join(__dirname, '..', 'evidence', 'floci-dash');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
const PAGES = [
  ['console-home', '/console/aws'],
  ['lambda-functions', '/cloud-explorer/aws/serverless'],
  ['api-gateway', '/cloud-explorer/aws/apigateway'],
  ['secrets-manager', '/secretsmanager'],
  ['iam-roles', '/cloud-explorer/aws/identity'],
  ['cloudwatch-logs', '/cloud-explorer/aws/logs'],
  ['cloudwatch-metrics-alarms', '/cloud-explorer/aws/cloudwatch'],
  ['s3-website-bucket', '/cloud-explorer/aws/storage'],
];
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  let n = 0;
  for (const [name, p] of PAGES) {
    n += 1;
    await page.goto(BASE + p, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2500));
    const file = path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log('saved', path.relative(path.join(__dirname, '..'), file));
  }
  await browser.close();
})().catch((e) => { console.error(e.message); process.exit(1); });

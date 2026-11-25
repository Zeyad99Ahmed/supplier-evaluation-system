// Saves evidence/floci-dash/03-api-gateway.png from live AWS CLI data (see scripts/lib/api-evidence.js).
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { buildApiEvidenceHtml } = require('./lib/api-evidence');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
(async () => {
  const html = await buildApiEvidenceHtml();
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const out = path.join(__dirname, '..', 'evidence', 'floci-dash', '03-api-gateway.png');
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('saved', path.relative(path.join(__dirname, '..'), out));
})().catch((e) => { console.error(e.message); process.exit(1); });

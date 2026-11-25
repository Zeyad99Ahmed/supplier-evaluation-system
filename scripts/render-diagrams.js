// Renders docs/diagrams/*.svg to PNG (for the report) with the installed Chrome.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const dir = path.join(__dirname, '..', 'docs', 'diagrams');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => fs.existsSync(p));
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(dir, f), 'utf8');
    const [, w, h] = svg.match(/width="(\d+)" height="(\d+)"/);
    await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1.5 });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: path.join(dir, f.replace('.svg', '.png')), clip: { x: 0, y: 0, width: Number(w), height: Number(h) } });
    console.log('rendered', f.replace('.svg', '.png'));
  }
  await browser.close();
})();

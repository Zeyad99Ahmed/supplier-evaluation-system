// Builds an evidence page from LIVE data: the API Gateway HTTP APIs and routes on Floci (AWS CLI
// apigatewayv2 get-apis / get-routes) plus real requests through each gateway. Floci Dash does not list
// HTTP APIs (API Gateway v2), so this page is used in the report and the demo video instead.
const { execFileSync } = require('child_process');

const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--output', 'json', '--profile', 'floci'], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function buildApiEvidenceHtml() {
  const apis = aws('apigatewayv2', 'get-apis').Items.filter((a) => a.Name.startsWith('ses-')).sort((a, b) => a.Name.localeCompare(b.Name));
  const rows = [];
  for (const a of apis) {
    const routes = aws('apigatewayv2', 'get-routes', '--api-id', a.ApiId).Items.map((r) => r.RouteKey);
    const url = `http://${a.ApiId}.execute-api.localhost.floci.io:4566`;
    const health = await fetch(`${url}/api/health`).then((r) => r.text()).catch((e) => e.message);
    const internal = await fetch(`${url}/internal/orders/x`).then(async (r) => `${r.status} ${await r.text()}`).catch((e) => e.message);
    rows.push({ name: a.Name, id: a.ApiId, proto: a.ProtocolType, routes, url, health, internal });
  }
  const cmd = (c) => `<div class="cmd">$ ${esc(c)}</div>`;
  const body = rows.map((r) => `
    <div class="api">
      <div class="h"><b>${esc(r.name)}</b> <span class="tag">${esc(r.proto)}</span> <span class="id">ApiId ${esc(r.id)}</span> <span class="id">${r.routes.length} routes</span></div>
      <div class="routes">${r.routes.filter((k) => !k.startsWith('OPTIONS')).sort().map((k) => `<span>${esc(k)}</span>`).join('')}</div>
      ${cmd(`curl ${r.url}/api/health`)}<div class="out ok">${esc(r.health)}</div>
      ${cmd(`curl ${r.url}/internal/orders/x`)}<div class="out bad">${esc(r.internal)}  &lt;- answered by API Gateway: internal routes are not published</div>
    </div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>API Gateway on Floci</title><style>
    body{margin:0;background:#0b1220;color:#e2e8f0;font:14px Consolas,monospace;padding:22px 28px 90px}
    h1{font:600 22px Segoe UI,Arial;margin:0 0 4px;color:#fff} .sub{font:14px Segoe UI,Arial;color:#94a3b8;margin-bottom:14px}
    .api{border:1px solid #1e293b;border-radius:10px;padding:10px 14px;margin:10px 0;background:#0f172a}
    .h{font:15px Segoe UI,Arial;margin-bottom:6px} .tag{background:#0f766e;color:#fff;border-radius:6px;padding:1px 7px;font-size:12px}
    .id{color:#94a3b8;margin-left:10px;font-size:13px} .routes span{display:inline-block;background:#1e293b;border-radius:5px;padding:1px 6px;margin:2px 4px 2px 0;font-size:12px;color:#cbd5e1}
    .cmd{color:#7dd3fc;margin-top:6px} .out{white-space:pre-wrap;font-size:12.5px} .ok{color:#86efac} .bad{color:#fca5a5}
  </style></head><body>
  <h1>Amazon API Gateway on Floci - live</h1>
  <div class="sub">$ aws apigatewayv2 get-apis / get-routes --profile floci, and real requests through each gateway (captured ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC)</div>
  ${body}</body></html>`;
}

module.exports = { buildApiEvidenceHtml };

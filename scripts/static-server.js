// Tiny static file server for the website during local development (S3 serves it on Floci/AWS).
// Sends the same security headers the S3/CloudFront setup would use, and only serves files inside
// the frontend folder (no directory traversal).
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function startStaticServer(root, port) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.resolve(base, '.' + (urlPath.endsWith('/') ? urlPath + 'index.html' : urlPath));
    if (!file.startsWith(base)) { res.writeHead(403); return res.end('Forbidden'); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-store',
      });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

module.exports = { startStaticServer };

if (require.main === module) {
  startStaticServer(path.join(__dirname, '..', 'frontend'), Number(process.env.PORT || 8080)).then(() => console.log('website on http://localhost:' + (process.env.PORT || 8080)));
}

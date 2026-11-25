// Builds one deployment package per service (Lab 7 "npm run zip", per service):
//   dist/<service>.zip  =  <service>/ (app, lambda.js, src)  +  shared/  +  node_modules/ (production only)
// Lambda handler setting: <service>/lambda.handler. .env files, tests and other services are NOT included,
// so each function only contains its own code (independent deployment, smaller blast radius).
//   node scripts/package-lambda.js all | auth-service | supplier-service | order-service | evaluation-service

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const SERVICES = ['auth-service', 'supplier-service', 'order-service', 'evaluation-service'];
const target = process.argv[2] || 'all';
const list = target === 'all' ? SERVICES : [target];
if (!list.every((s) => SERVICES.includes(s))) { console.error('Unknown service ' + target); process.exit(1); }

const dist = path.join(ROOT, 'dist');
fs.mkdirSync(dist, { recursive: true });

// production node_modules, installed once into dist/_deps
const deps = path.join(dist, '_deps');
if (!fs.existsSync(path.join(deps, 'node_modules')) || process.argv.includes('--fresh')) {
  fs.rmSync(deps, { recursive: true, force: true });
  fs.mkdirSync(deps, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'services', 'package.json'), path.join(deps, 'package.json'));
  if (fs.existsSync(path.join(ROOT, 'services', 'package-lock.json'))) fs.copyFileSync(path.join(ROOT, 'services', 'package-lock.json'), path.join(deps, 'package-lock.json'));
  execSync('npm install --omit=dev --no-audit --no-fund', { cwd: deps, stdio: 'inherit' });
}

const skip = (p) => /(^|[\\/])(\.env.*|.*\.test\.js|server\.js)$/.test(p);
for (const svc of list) {
  const zip = new AdmZip();
  const addDir = (dir, zipPath) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const zp = zipPath ? `${zipPath}/${e.name}` : e.name;
      if (e.isDirectory()) addDir(full, zp);
      else if (!skip(e.name)) zip.addFile(zp, fs.readFileSync(full));
    }
  };
  addDir(path.join(ROOT, 'services', svc), svc);
  addDir(path.join(ROOT, 'services', 'shared'), 'shared');
  addDir(path.join(deps, 'node_modules'), 'node_modules');
  zip.addFile('package.json', fs.readFileSync(path.join(ROOT, 'services', 'package.json')));
  const out = path.join(dist, `${svc}.zip`);
  zip.writeZip(out);
  console.log(`built dist/${svc}.zip (${(fs.statSync(out).size / 1048576).toFixed(1)} MB) handler=${svc}/lambda.handler`);
}

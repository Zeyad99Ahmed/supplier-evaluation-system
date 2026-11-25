// Builds the hand-over packages from the project folder (no Git needed, no commits are made):
//   SUBMISSION/handover/<Name>_team_repo_files.zip   files Ebraheem / Karim commit on their own branch
//   SUBMISSION/handover/<Name>_personal_repo.zip     ready folder for each member's personal repository
//   SUBMISSION/handover/FILES_<NAME>.txt             exact file list per member (used by the guide)
// Every project file must belong to exactly one owner (MAIN, Zeyad, Ebraheem or Karim), otherwise it stops.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const ROOT = path.join(__dirname, '..');
const SUB = path.join(ROOT, '..', 'SUBMISSION', 'handover');
const links = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'report', 'links.json'), 'utf8'));
const TEAM = links.repo || 'the team repository supplier-evaluation-system';

// never packaged: dependencies, build output, local data, logs, secret files
const IGNORE = /^(node_modules|services\/node_modules|dist|logs|\.localdata|\.git)(\/|$)|(^|\/)\.env(\.local)?$|^infra\/\.env\.floci$|^infra\/floci-urls\.env$/;

const OWNERS = {
  MAIN: [/^\.gitignore$/, /^\.gitattributes$/, /^README\.md$/, /^package(-lock)?\.json$/, /^\.env\.example$/, /^docs\/GITHUB_SUBMISSION_GUIDE\.md$/],
  Zeyad: [/^services\/shared\//, /^services\/package(-lock)?\.json$/, /^services\/(auth|supplier)-service\//,
    /^frontend\/css\//, /^frontend\/js\/(api|ui|auth|config|dashboard|login|admin|suppliers|supplier)\.js$/,
    /^frontend\/(index|dashboard|admin|suppliers|supplier)\.html$/, /^frontend\/pages\/(dashboard|admin|suppliers|supplier)\.body\.html$/,
    /^scripts\/(build-pages|local-up|static-server|secret-scan|log-query|capture-floci-dash)\.js$/, /^scripts\/lib\/env\.js$/, /^infra\/monitoring\.sh$/],
  Karim: [/^services\/evaluation-service\//, /^frontend\/(pages\/)?evaluations(\.body)?\.html$/, /^frontend\/js\/evaluations\.js$/,
    /^database\//, /^scripts\/db-setup\.js$/, /^tests\/resilience\.test\.js$/, /^scripts\/seed-demo\.js$/, /^scripts\/render-diagrams\.js$/, /^docs\/diagrams\//],
  Ebraheem: [/^services\/order-service\//, /^frontend\/(pages\/)?orders(\.body)?\.html$/, /^frontend\/js\/orders\.js$/, /^infra\//,
    /^scripts\/(package-lambda|capture-screenshots|capture-api-evidence|record-demo|package-handover)\.js$/, /^scripts\/lib\/api-evidence\.js$/,
    /^tests\/(lambda-handler\.test|lib|run-all)\.js$/, /^docs\/(DOCKER_FLOCI_SETUP\.md|RECOVERY\.md|floci-deploy\.log|deploy-dry-run\.log)$/,
    /^docs\/report\//, /^evidence\//],
};

const all = [];
(function walk(rel) {
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (IGNORE.test(p)) continue;
    if (e.isDirectory()) walk(p); else all.push(p);
  }
})('');

const owned = { MAIN: [], Zeyad: [], Karim: [], Ebraheem: [] };
const orphan = [];
for (const f of all) {
  // infra/monitoring.sh is Zeyad's even though infra/ is Ebraheem's
  const hits = Object.keys(OWNERS).filter((o) => OWNERS[o].some((r) => r.test(f)));
  const who = hits.includes('Zeyad') ? 'Zeyad' : hits.length === 1 ? hits[0] : null;
  if (!who) orphan.push(`${f} (${hits.join(',') || 'no owner'})`); else owned[who].push(f);
}
if (orphan.length) { console.error('Files without exactly one owner:\n' + orphan.join('\n')); process.exit(1); }

fs.rmSync(SUB, { recursive: true, force: true });
fs.mkdirSync(SUB, { recursive: true });
for (const [who, list] of Object.entries(owned)) {
  fs.writeFileSync(path.join(SUB, `FILES_${who.toUpperCase()}.txt`), list.join('\n') + '\n');
  console.log(`${who.padEnd(8)} ${list.length} files`);
}
for (const who of ['Ebraheem', 'Karim']) {
  const z = new AdmZip();
  owned[who].forEach((f) => z.addFile(f, fs.readFileSync(path.join(ROOT, f))));
  z.writeZip(path.join(SUB, `${who}_team_repo_files.zip`));
}

// ---------------------------------------------------------------- personal repositories
const readme = (p) => `# ${p.title}

Personal proof-of-work repository of **${p.student}** for the Group 26 coursework
*Supplier Directory & Evaluation System* (Cloud Computing and Cloud Security, 26CSCN29H).

The complete, runnable, integrated system (all three services, shared login, deployment to Floci, tests,
report) is in the team repository: ${TEAM} (branch \`${p.branch}\`). This repository contains only the
component I own, so it is not meant to run on its own.

## Owned component: ${p.component}

${p.functions.map((f) => `- ${f}`).join('\n')}

## How it works with the other services

${p.integration.map((f) => `- ${f}`).join('\n')}

## Security controls I implemented

${p.security.map((f) => `- ${f}`).join('\n')}

## AWS services used by my component (deployed on Floci)

${p.aws.map((f) => `- ${f}`).join('\n')}

No credentials are stored in this repository: secrets come from AWS Secrets Manager on Floci and from a
git-ignored \`.env.local\` file during local development.
`;

const PEOPLE = {
  Zeyad: {
    title: 'ses-supplier-service-zeyad', student: 'Zeyad Ahmed Abdelaziz Abdelmaksoud El Gohary (239924)', branch: 'zeyad',
    component: 'Supplier Service (+ shared authentication, logging and monitoring lead)',
    functions: ['F1 Create supplier profile - POST /api/suppliers (Admin)', 'F2 Search / filter suppliers - GET /api/suppliers', 'F3 Update supplier details - PUT /api/suppliers/:id (Admin)',
      'F4 Supplier details with contacts, contracts and status history - GET /api/suppliers/:id', 'F5 Contracts with date and overlap rules, value converted to EGP - POST /api/suppliers/:id/contracts, PATCH /api/contracts/:id',
      'F6 Status workflow with reasons, history and automatic UNDER_REVIEW - PATCH /api/suppliers/:id/status', 'F7 Recommendations ranked by score and on-time rate - GET /api/suppliers/recommendations',
      'F8 Archive supplier, refused while it has open orders - DELETE /api/suppliers/:id', 'Shared Auth Service: login with lock-out, logout, me, Admin-created Staff accounts, security activity monitor'],
    integration: ['Order Service -> Supplier: GET /internal/suppliers/:id/eligibility (active + valid contract)', 'Evaluation Service -> Supplier: PUT /internal/suppliers/:id/performance (new average, automatic review rule)',
      'Supplier -> Order: open-order count before archiving; Supplier -> Evaluation: contract value in EGP'],
    security: ['Admin-only writes enforced with requireRole() in the backend', 'Central input validation, forbidden client fields, unique names (409)', 'scrypt password hashing, JWT verification, lock-out after 5 failures',
      'Internal routes accept only service tokens from allowed callers', 'Database role supplier_svc with only the rights the code needs (no DELETE on suppliers)', 'Structured JSON logs without secrets; CloudWatch metric filters and alarms'],
    aws: ['AWS Lambda ses-supplier-service and ses-auth-service', 'Amazon API Gateway ses-supplier-service-api', 'AWS IAM role ses-supplier-service-role (least privilege)', 'AWS Secrets Manager ses/supplier-service', 'Amazon CloudWatch Logs, metric filters and alarms'],
    copy: ['services/supplier-service', 'services/auth-service', 'services/shared', 'frontend/pages/suppliers.body.html', 'frontend/pages/supplier.body.html', 'frontend/pages/admin.body.html',
      'frontend/js/suppliers.js', 'frontend/js/supplier.js', 'frontend/js/admin.js', 'frontend/js/login.js', 'frontend/js/auth.js', 'frontend/js/api.js', 'frontend/js/ui.js', 'frontend/css', 'frontend/index.html',
      'infra/monitoring.sh', 'scripts/log-query.js', 'scripts/secret-scan.js'],
  },
  Ebraheem: {
    title: 'ses-order-service-ebraheem', student: 'Ebraheem Mohamed Ebraheem Mohamed Amin (249043)', branch: 'ebraheem',
    component: 'Order Service (+ cloud deployment lead)',
    functions: ['F1 Create purchase order with supplier eligibility, EGP conversion, contract limit and approval threshold - POST /api/orders', 'F2 List / filter orders (Staff: own only) - GET /api/orders',
      'F3 Order details with status history - GET /api/orders/:id', 'F4 Delivery workflow with on-time / days-late calculation - PATCH /api/orders/:id/status',
      'F5 Approve / reject, never your own order - PATCH /api/orders/:id/approval (Admin)', 'F6 Spending summary per supplier and month - GET /api/orders/summary', 'F7 Retry a pending EGP conversion - POST /api/orders/:id/convert'],
    integration: ['Order -> Supplier: eligibility check before every order', 'Order -> Evaluation: POST /internal/convert (ExchangeRate API)', 'Evaluation -> Order: GET /internal/orders/:id (delivered? owner?); Supplier -> Order: open-order count'],
    security: ['Ownership checks: other users\' orders answer 404', 'Status transitions validated in transactions with row locks', 'Segregation of duties: self-approval blocked (403)', 'Input validation of quantities, prices, dates and currencies',
      'Database role order_svc without DELETE', 'Per-service IAM roles and least-privilege policies in the deployment'],
    aws: ['AWS Lambda ses-order-service', 'Amazon API Gateway ses-order-service-api', 'AWS IAM role ses-order-service-role', 'AWS Secrets Manager ses/order-service', 'Amazon S3 website bucket ses-web, CloudWatch Logs'],
    copy: ['services/order-service', 'frontend/pages/orders.body.html', 'frontend/js/orders.js', 'infra/floci', 'infra/iam', 'infra/routes.txt', 'infra/lib.sh', 'infra/deploy.sh', 'infra/deploy-frontend.sh',
      'infra/check-deploy.sh', 'infra/destroy.sh', 'infra/.env.floci.example', 'scripts/package-lambda.js', 'scripts/record-demo.js', 'tests/run-all.js', 'tests/lib.js', 'tests/lambda-handler.test.js', 'docs/DOCKER_FLOCI_SETUP.md'],
  },
  Karim: {
    title: 'ses-evaluation-service-karim', student: 'Karim Hisham Ebrahim Abdelbaset Mohamed (249581)', branch: 'karim',
    component: 'Evaluation Service (+ database setup and external API lead)',
    functions: ['F1 Rate a delivered order once, weighted score, score pushed to Supplier - POST /api/evaluations (Staff)', 'F2 Supplier performance report - GET /api/performance/suppliers/:id',
      'F3 Compare 2-5 suppliers - GET /api/performance/compare', 'F4 Rating history with filters - GET /api/evaluations', 'F5 Edit / delete own rating within 7 days - PUT / DELETE /api/evaluations/:id',
      'F6 Exchange rates and conversion with the ExchangeRate API - GET /api/rates/:currency, /api/rates/convert, POST /internal/convert'],
    integration: ['Evaluation -> Order: is the order DELIVERED and raised by this user?', 'Evaluation -> Supplier: new average (may set UNDER_REVIEW)', 'Order and Supplier -> Evaluation: conversion of order and contract values to EGP'],
    security: ['Only Staff can rate; only the author can edit/delete (others 404)', 'Scores validated 1-5 in the API and by a database CHECK; UNIQUE(order_id)', 'API key only in Secrets Manager / git-ignored env file, never logged',
      'Provider response validated, 5 s timeout, cache and stale fallback', 'Per-service database roles and least-privilege grants (database/02_roles_grants.sql)'],
    aws: ['AWS Lambda ses-evaluation-service', 'Amazon API Gateway ses-evaluation-service-api', 'AWS IAM role ses-evaluation-service-role', 'AWS Secrets Manager ses/evaluation-service (ExchangeRate API key)', 'Amazon CloudWatch Logs + ExchangeApiFailures metric'],
    copy: ['services/evaluation-service', 'frontend/pages/evaluations.body.html', 'frontend/js/evaluations.js', 'database', 'scripts/db-setup.js', 'scripts/seed-demo.js', 'tests/resilience.test.js'],
  },
};

function collect(p, list = []) {
  if (IGNORE.test(p)) return list;
  const full = path.join(ROOT, p);
  if (fs.statSync(full).isDirectory()) fs.readdirSync(full).forEach((c) => collect(`${p}/${c}`, list));
  else list.push(p);
  return list;
}
for (const [who, person] of Object.entries(PEOPLE)) {
  const z = new AdmZip();
  person.copy.flatMap((c) => collect(c)).forEach((f) => z.addFile(`${person.title}/${f}`, fs.readFileSync(path.join(ROOT, f))));
  z.addFile(`${person.title}/README.md`, Buffer.from(readme(person)));
  z.addFile(`${person.title}/.gitignore`, Buffer.from('node_modules/\n.env\n.env.*\n!.env.floci.example\n'));
  z.addFile(`${person.title}/.gitattributes`, Buffer.from('* text=auto eol=lf\n'));
  z.writeZip(path.join(SUB, `${who}_personal_repo.zip`));
  console.log(`${who}_personal_repo.zip: ${z.getEntries().length} files`);
}

// Builds the final report (technical evidence pack) as .docx from the REAL evidence files:
//   evidence/*.json (test runs), evidence/log-monitoring.json, evidence/screenshots/*.png, docs/diagrams/*.png
//   node docs/report/build-report.js  ->  docs/report/Group26_Final_Report.docx
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ShadingType,
  ImageRun, AlignmentType, PageBreak, Footer, Header, PageNumber, LevelFormat, BorderStyle,
} = require('docx');

const ROOT = path.join(__dirname, '..', '..');
const ev = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'evidence', f), 'utf8'));
const tests = ev('test-results.json');
const resil = ev('resilience-results.json');
const lambda = ev('lambda-results.json');
const logs = ev('log-monitoring.json');
const deployed = ev('test-results-deployed.json');
const cw = fs.readFileSync(path.join(ROOT, 'evidence', 'floci', 'cloudwatch.txt'), 'utf8');
const checkDeploy = fs.readFileSync(path.join(ROOT, 'evidence', 'floci', 'check-deploy.txt'), 'utf8').trim().split('\n');
// Links come from docs/report/links.json. A link that is not filled in yet is printed as a neutral
// sentence (the links are also submitted separately on the e-learning page).
const linkCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'links.json'), 'utf8'));
const orSubmitted = (v) => (v && v.trim() ? v.trim() : 'Provided with the e-learning submission');
const LINKS = {
  repo: orSubmitted(linkCfg.repo),
  video: orSubmitted(linkCfg.video),
  personal: { zeyad: orSubmitted(linkCfg.personalRepos.zeyad), ebraheem: orSubmitted(linkCfg.personalRepos.ebraheem), karim: orSubmitted(linkCfg.personalRepos.karim) },
};
const repoBase = linkCfg.repo && linkCfg.repo.trim() ? linkCfg.repo.trim().replace(/\/$/, '') : null;
const branchLink = (b) => (repoBase ? `${repoBase}/tree/${b}  (commits: ${repoBase}/commits/${b})` : `branch ${b} of the team repository`);

// ---------------------------------------------------------------- helpers
const FONT = 'Calibri';
const W = 9026; // A4 with 1-inch margins, in DXA
const t = (text, o = {}) => new TextRun({ text, font: FONT, size: o.size || 22, bold: o.bold, italics: o.italics, color: o.color });
const P = (...runs) => new Paragraph({ spacing: { after: 120, line: 276 }, children: runs.map((r) => (typeof r === 'string' ? t(r) : r)) });
const Pb = (label, text) => P(t(label, { bold: true }), t(text));
const H1_TITLES = [];
const H1 = (s) => { H1_TITLES.push(s); return new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: s })] }); };
const H2 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s })] });
const H3 = (s) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: s })] });
const B = (...runs) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 }, children: runs.map((r) => (typeof r === 'string' ? t(r) : r)) });
const note = (s) => new Paragraph({ spacing: { after: 120 }, shading: { type: ShadingType.CLEAR, fill: 'FFF4D6' }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'D97706', space: 6 } }, children: [t(s, { italics: true, size: 20 })] });
const pageBreak = () => new Paragraph({ children: [new PageBreak()] });
const caption = (s) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [t(s, { italics: true, size: 18, color: '475569' })] });

function table(headers, rows, widths, { size = 18 } = {}) {
  const total = widths.reduce((a, b) => a + b, 0);
  const ws = widths.map((w) => Math.round((w / total) * W));
  ws[ws.length - 1] += W - ws.reduce((a, b) => a + b, 0);
  const cell = (text, i, head) => new TableCell({
    width: { size: ws[i], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: '12302D' } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: String(text).split('\n').map((line) => new Paragraph({ children: [t(line, { size, bold: head, color: head ? 'FFFFFF' : undefined })] })),
  });
  return new Table({
    width: { size: W, type: WidthType.DXA }, columnWidths: ws,
    rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, i, true)) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c ?? '', i, false)) }))],
  });
}
const gap = () => new Paragraph({ spacing: { after: 60 }, children: [] });

function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), data: b };
}
function image(file, { maxW = 600, maxH = 780 } = {}) {
  const { w, h, data } = pngSize(file);
  let width = maxW; let height = Math.round((h / w) * width);
  if (height > maxH) { height = maxH; width = Math.round((w / h) * height); }
  return new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new ImageRun({ type: 'png', data, transformation: { width, height } })] });
}
const SHOTS = 'floci-screenshots'; // screenshots of the app served from Floci (S3 + API Gateway + Lambda)
const shot = (name, cap, opts) => [image(path.join(ROOT, 'evidence', SHOTS, name), opts), caption(cap)];
const dash = (name, cap) => [image(path.join(ROOT, 'evidence', 'floci-dash', name), { maxW: 600, maxH: 420 }), caption(cap)];

const resultRows = (list) => list.map((r) => [r.id, r.scenario, r.expected, r.actual, r.pass ? 'PASS' : 'FAIL', r.evidence.length > 140 ? r.evidence.slice(0, 140) + '…' : r.evidence]);
const byIds = (prefix) => tests.results.filter((r) => r.id.startsWith(prefix));
const allTests = [...tests.results, ...resil.results, ...lambda.results, ...deployed.results];
const passed = allTests.filter((r) => r.pass).length;

// ---------------------------------------------------------------- content
const c = [];

// Cover
c.push(new Paragraph({ spacing: { before: 1800, after: 200 }, alignment: AlignmentType.CENTER, children: [t('Cloud Computing and Cloud Security (26CSCN29H)', { size: 28, color: '0F766E', bold: true })] }));
c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [t('Group Project - Final Phase: Technical Evidence Pack', { size: 26 })] }));
c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [t('Supplier Directory & Evaluation System', { size: 48, bold: true })] }));
c.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [t('Group 26', { size: 28, bold: true })] }));
c.push(table(['Student', 'ID', 'Owned service', 'Shared lead roles'], [
  ['Zeyad Ahmed Abdelaziz Abdelmaksoud El Gohary', '239924', 'Supplier Service', 'Authentication/identity, Logging & monitoring'],
  ['Ebraheem Mohamed Ebraheem Mohamed Amin', '249043', 'Order Service', 'Cloud deployment, Report & threat model'],
  ['Karim Hisham Ebrahim Abdelbaset Mohamed', '249581', 'Evaluation Service', 'Database setup, External API integration'],
], [40, 12, 20, 28], { size: 20 }));
c.push(gap());
c.push(table(['Item', 'Link / value'], [
  ['GitHub repository', LINKS.repo],
  ['Demo video (max 5 min)', LINKS.video],
  ['Personal repositories', `Zeyad: ${LINKS.personal.zeyad}\nEbraheem: ${LINKS.personal.ebraheem}\nKarim: ${LINKS.personal.karim}`],
  ['Deployed application (Floci)', 'http://localhost:4566/ses-web/index.html  (S3 website on Floci; API URLs in infra/floci-urls.env)'],
  ['Assigned TA', 'Mohey'],
], [30, 70], { size: 20 }));
c.push(pageBreak());

const TOC_AT = c.length; // static contents list is inserted here at the end (no Word field to update)
c.push(pageBreak());

// Evidence status
c.push(H1('Evidence status and how to read this report'));
c.push(P('Everything in this report describes the system that was actually built and tested. Test tables are generated from the stored test runs in the evidence/ folder (they were not typed by hand). ' +
  `In total ${passed} of ${allTests.length} automated checks passed: ${deployed.passed}/${deployed.results.length} tests against the system deployed on Floci, ${tests.passed}/${tests.results.length} functional, integration and security tests on the local integrated run, ${resil.passed}/${resil.results.length} resilience tests and ${lambda.passed}/${lambda.results.length} packaged-Lambda tests, plus the ${checkDeploy.length - 1}-point deployment smoke check.`));
c.push(table(['Environment', 'What was run', 'Evidence'], [
  ['Local integrated run (npm run local)', 'All 4 services as separate processes, each with its own PostgreSQL role, real ExchangeRate API, the website; demo data seeded through the APIs; all functional, integration and security tests; screenshots', 'evidence/test-results.*, evidence/resilience-results.*, evidence/screenshots/, evidence/log-monitoring.*'],
  ['Packaged Lambda functions', 'The 4 deployment zips (dist/*.zip) invoked as Lambda handlers with API Gateway v2 events; secrets read from (mock) Secrets Manager; Supplier -> Order call made with lambda:InvokeFunction through the AWS SDK', 'evidence/lambda-results.*'],
  ['Deployment scripts', 'infra/deploy.sh run per service against an AWS API mock (moto) with the Floci account id: secrets, IAM roles + least-privilege policies, Lambda functions, API Gateway routes, stage and permissions created', 'docs/deploy-dry-run.log'],
  ['Floci deployment (Docker Desktop, Floci + PostgreSQL containers)', `bash infra/deploy.sh all (4 Lambdas, 4 HTTP APIs, 4 secrets, 4 IAM roles, CloudWatch filters and alarms, S3 website); bash infra/check-deploy.sh (${checkDeploy[checkDeploy.length - 1]}); demo data seeded through API Gateway; tests/run-all.js against the API Gateway URLs (${deployed.passed}/${deployed.results.length} passed); Floci Dash and CloudWatch evidence`, 'docs/floci-deploy.log, evidence/floci/*, evidence/floci-dash/*, evidence/floci-screenshots/*, evidence/test-results-deployed.*'],
], [22, 50, 28]));
c.push(P('Screenshots of the application in this report are taken from the deployed version on Floci (website from the S3 bucket, data through API Gateway and Lambda). The local run produced the same screens (evidence/screenshots/).'));

// Feedback
c.push(H1('Phase 1 feedback and how it was addressed'));
c.push(table(['Phase 1 feedback (TA: Mohey)', 'What we changed in the implementation', 'Where to see it'], [
  ["Zeyad's Supplier and Ebraheem's Order are mostly CRUD. Each needs at least two more real functions.",
    'Supplier: contract management with overlap and date rules + EGP conversion, a status workflow (ACTIVE / UNDER_REVIEW / SUSPENDED / ARCHIVED) with reasons and history and an automatic review rule, supplier recommendations ranked by score, and archiving that is refused while orders are open. Order: eligibility check against the Supplier Service, contract spending limit, approval threshold with Admin approval/rejection and segregation of duties, delivery workflow with on-time / days-late calculation, spending summary, conversion retry.',
    'Section 3; tests SU-06..SU-11, OR-02..OR-10, IN-01..IN-03, SEC-08'],
  ["Put currency conversion where it's actually used.",
    'The ExchangeRate integration lives in the Evaluation Service (Karim) and is called by the Order Service for every order and by the Supplier Service for every contract. The EGP value, rate and rate date are stored with the order/contract and in the Evaluation price ledger; the contract limit, approval threshold, spending summary and supplier comparison all use the EGP values.',
    'Sections 3 and 5; tests SU-07, OR-01, OR-03, EV-08, RS-01..RS-05'],
  ['Split the services so each deploys on its own, with network calls between them (Order to Evaluation for conversion, Evaluation to Order for delivered status).',
    'Four separate Lambda functions, each with its own zip, IAM role, secret and API Gateway HTTP API (bash infra/deploy.sh <service>). Services never read each other\'s tables: Order -> Evaluation (POST /internal/convert), Evaluation -> Order (GET /internal/orders/:id for DELIVERED status and ownership), plus Order -> Supplier, Supplier -> Order and Evaluation -> Supplier. On Floci the calls use lambda:InvokeFunction; locally HTTP.',
    'Sections 2 and 6; tests OR-01, EV-01, EV-06, IN-01, LT-04'],
  ['Give each service its own database role once split.',
    'One PostgreSQL schema and one LOGIN role per service (auth_svc, supplier_svc, order_svc, evaluation_svc) with only the privileges its code uses; no role can read another schema; audit log is INSERT-only.',
    'Sections 3 and 8; database/02_roles_grants.sql; test SEC-15'],
  ['Make sure secrets are never committed.',
    '.gitignore for .env files, generated random secrets in git-ignored .env.local / infra/.env.floci, Secrets Manager on Floci, no keys in the frontend, and a secret scanner (scripts/secret-scan.js) run as test SEC-18.',
    'Sections 8 and 9; test SEC-18'],
  ['Go beyond the lab stack.',
    'Beyond Lab 5/7: four independently deployed Lambdas, JWT authentication with scrypt hashes and account lock-out, service-to-service tokens, Lambda-to-Lambda invocation, AWS Secrets Manager, CloudWatch metric filters and alarms, per-service DB roles, Helmet security headers and CSP, automated security/resilience tests and packaged-Lambda tests.',
    'Sections 6, 8, 11-13'],
], [26, 52, 22]));

// 1 Problem
c.push(H1('1. Problem definition'));
c.push(P('Procurement teams in small and medium companies often keep suppliers, contacts and contracts in spreadsheets and judge suppliers from memory. Orders are raised without checking that a contract is valid or still has budget, prices are quoted in several currencies, and nobody records how well each supplier delivered. The result is poor procurement decisions, repeat orders to unreliable vendors and no audit trail.'));
c.push(P('The Supplier Directory & Evaluation System is a cloud web application that keeps the supplier directory and contracts in one place, controls purchase orders with business rules, converts every value to EGP with live exchange rates, and turns post-delivery ratings into a performance score that feeds back into which suppliers may receive orders.'));
c.push(table(['User group (role)', 'Who they are', 'What they can do'], [
  ['Admin - Procurement Manager', 'Internal purchasing manager', 'Create Staff accounts; add/update suppliers, contacts and contracts; change supplier status / archive; approve or reject large orders; see all orders, spending and security monitoring'],
  ['Staff - Evaluator / receiving', 'Operations or receiving staff', 'Search suppliers and recommendations; raise purchase orders; mark their orders delivered/cancelled; rate delivered orders (quality, price, delivery) and edit/delete their own ratings for 7 days'],
], [24, 24, 52]));
c.push(gap());
c.push(Pb('Expected benefit: ', 'one source of truth for suppliers and contracts; spending kept inside contract limits; orders above 50,000 EGP approved by a second person; all values comparable in EGP; objective supplier scores that automatically flag poor suppliers for review.'));
c.push(table(['In scope', 'Out of scope (and why)'], [
  ['Supplier directory: categories, profiles, contacts, contracts, status workflow, recommendations', 'Online payment processing (needs a payment provider and PCI scope)'],
  ['Purchase orders: eligibility, contract limits, approval, delivery tracking, spending summary', 'Real-time GPS shipment tracking (hardware/API complexity)'],
  ['Post-delivery evaluation, performance reports, supplier comparison, EGP conversion', 'Native mobile apps (responsive web app instead)'],
  ['Admin/Staff authentication and authorisation, security logging and monitoring', 'Self-service supplier portal and supplier logins'],
  ['Deployment to Floci (AWS emulator) with the same scripts as real AWS', 'Multi-company tenancy, email notifications'],
], [55, 45]));

// 2 Architecture
c.push(H1('2. Architecture diagram'));
c.push(image(path.join(ROOT, 'docs', 'diagrams', 'architecture.png'), { maxW: 620 }));
c.push(caption('Figure 1 - Layers, cloud services, service-to-service calls and the external API'));
c.push(table(['Layer', 'Responsibility', 'Cloud service', 'Talks to (and how)'], [
  ['Presentation', 'HTML/CSS/JS pages per service; forms, validation messages, tables', 'Amazon S3 static website (bucket ses-web)', 'Browser loads files from S3, then calls the APIs with fetch() (JSON, Bearer JWT); CORS allows only the site origin'],
  ['API layer', 'Publishes only the listed public routes per service, throttling', '4 x API Gateway HTTP APIs, $default stage', 'AWS_PROXY integration (payload 2.0) to its own Lambda; unknown routes and /internal/* get 404 at the gateway'],
  ['Application / business logic', 'Validation, business rules, authorisation, ownership', '4 x AWS Lambda (Node.js, Express via serverless-http)', 'Other services through lambda:InvokeFunction + service token; DB through its own role; secrets from Secrets Manager'],
  ['Data', 'Persistent storage per service', 'PostgreSQL 16 (container next to Floci, or Neon)', 'Parameterised SQL with node-postgres; TLS (sslmode=require) on Neon'],
  ['Operations', 'Logs, metrics, alarms, secrets, identities', 'CloudWatch Logs/Metrics/Alarms, Secrets Manager, IAM', 'Lambda stdout -> log groups; metric filters -> alarms'],
  ['External', 'Exchange rates to EGP', 'ExchangeRate-API (HTTPS)', 'Called only by the Evaluation Service; cached 6 h'],
], [14, 28, 24, 34]));
c.push(H3('One complete request: Staff rates a delivered order'));
[
  'The Evaluations page (Karim) posts { orderId, quality, price, delivery, comment } to POST /api/evaluations on the Evaluation API Gateway with the JWT.',
  'API Gateway matches the route and invokes ses-evaluation-service. Express logs the request (no body), checks CORS, parses JSON (415 if not JSON) and verifies the JWT (401) and the staff role (403).',
  'The controller validates the scores are whole numbers 1-5 and the comment length (400).',
  'Evaluation -> Order: lambda:InvokeFunction of ses-order-service with a 60-second service token for GET /internal/orders/:id. 404 if no such order; 404 if it belongs to someone else (ownership); 409 if it is not DELIVERED.',
  'The rating is inserted (UNIQUE order_id -> 409 ALREADY_RATED), the overall score 0.4q + 0.3p + 0.3d is computed and the supplier average is recalculated.',
  'Evaluation -> Supplier: PUT /internal/suppliers/:id/performance with the new average. If the average is below 2.5 after 3 or more ratings the Supplier Service sets the supplier UNDER_REVIEW, and from then on the Order Service refuses new orders for it.',
  'The API returns 201 with the rating and the new supplier performance; the page shows a confirmation and refreshes the history.',
].forEach((s, i) => c.push(P(t(`${i + 1}. `, { bold: true }), t(s))));

// 3 Services
c.push(H1('3. Service / API list and data model'));
c.push(P('All public routes require a valid JWT except login and health. Every error uses one JSON shape: { "error": { "code", "message", "details" } }. Common codes: 400 validation, 401 not logged in / invalid token, 403 wrong role, 404 not found or not yours, 409 business-rule conflict, 413 body too large, 415 not JSON, 422 business rule on another service\'s data, 429 account locked, 502/503 dependency unavailable.'));
const api = (rows) => table(['Method & endpoint', 'Purpose / business rule', 'Validates', 'Success', 'Errors', 'Roles'], rows, [22, 30, 20, 7, 11, 10], { size: 16 });
c.push(H2('3.1 Supplier Service - Zeyad (Lambda ses-supplier-service)'));
c.push(api([
  ['POST /api/suppliers', 'F1 Create supplier profile (+ optional first contact), status ACTIVE, history row', 'name 2-120 unique (case-insensitive), categoryId exists, email, phone; status/score cannot be sent', '201', '400, 401, 403, 409, 415', 'Admin'],
  ['GET /api/suppliers', 'F2 Search / filter: text, category, status, min score, sort, pagination', 'types and allowed values', '200', '400, 401', 'Admin, Staff'],
  ['GET /api/suppliers/:id', 'F4 Details with contacts, contracts (current flag) and status history', 'id format', '200', '401, 404', 'Admin, Staff'],
  ['PUT /api/suppliers/:id', 'F3 Update details; archived suppliers are read-only', 'as create; unique name', '200', '400, 401, 403, 404, 409', 'Admin'],
  ['POST /api/suppliers/:id/contracts', 'F5 Add contract; no overlap with an active contract; value converted to EGP by Evaluation', 'title, dates (end > start), value > 0, currency allow-list', '201', '400, 401, 403, 404, 409', 'Admin'],
  ['PATCH /api/contracts/:id', 'F5 Edit or terminate a contract (re-converts when value/currency change)', 'same as above', '200', '400, 401, 403, 404, 409', 'Admin'],
  ['PATCH /api/suppliers/:id/status', 'F6 Status workflow with allowed transitions and a reason, recorded in history', 'status, reason 5-300', '200', '400, 401, 403, 404, 409', 'Admin'],
  ['GET /api/suppliers/recommendations', 'F7 Eligible suppliers of a category ranked by score, on-time rate, rating count', 'categoryId', '200', '400, 401, 404', 'Admin, Staff'],
  ['DELETE /api/suppliers/:id', 'F8 Archive (soft delete); refused if the Order Service reports open orders; terminates contracts', 'id', '200', '401, 403, 404, 409', 'Admin'],
  ['POST/DELETE /api/suppliers/:id/contacts[/:cid]', 'Add / remove contact', 'name, e-mail or phone', '201/200', '400, 401, 403, 404', 'Admin'],
  ['GET/POST /api/categories', 'List categories with supplier counts / add category', 'name unique', '200/201', '400, 401, 403, 409', 'All / Admin'],
  ['GET /internal/suppliers/:id/eligibility', 'For Order: ACTIVE + contract valid on the date?', 'service token from order-service', '200', '401, 403, 404', 'service'],
  ['PUT /internal/suppliers/:id/performance', 'From Evaluation: store score; auto UNDER_REVIEW if avg < 2.5 after >= 3 ratings', 'service token from evaluation-service', '200', '400, 401, 403, 404', 'service'],
]));
c.push(H2('3.2 Order Service - Ebraheem (Lambda ses-order-service)'));
c.push(api([
  ['POST /api/orders', 'F1 Create PO: Supplier eligibility, EGP conversion via Evaluation, contract remaining value, approval if > 50,000 EGP or no rate', 'supplierId, description 3-300, quantity 1-100000, unitPrice > 0, currency, orderDate not future and <= 30 days old, expectedDate >= orderDate', '201', '400, 401, 415, 422, 503', 'Admin, Staff'],
  ['GET /api/orders', 'F2 List / filter by supplier, status, dates, text; Staff see only their own', 'filter values', '200', '400, 401', 'Admin (all), Staff (own)'],
  ['GET /api/orders/:id', 'F3 Order with status history', 'ownership (other user -> 404)', '200', '401, 404', 'Owner, Admin'],
  ['PATCH /api/orders/:id/status', 'F4 APPROVED -> DELIVERED (on-time, days late) or cancel before delivery', 'status, deliveredDate (not future, >= order date), note', '200', '400, 401, 404, 409', 'Owner, Admin'],
  ['PATCH /api/orders/:id/approval', 'F5 Approve / reject PENDING_APPROVAL; nobody may decide their own order', 'decision, note (required for reject)', '200', '400, 401, 403, 404, 409', 'Admin'],
  ['GET /api/orders/summary', 'F6 Spend in EGP per supplier and month, on-time rate, avg days late, pending counts', 'dates', '200', '400, 401', 'Admin (all), Staff (own)'],
  ['POST /api/orders/:id/convert', 'F7 Retry a pending EGP conversion', 'ownership', '200', '401, 404, 409, 502', 'Owner, Admin'],
  ['GET /internal/orders/:id', 'For Evaluation: status, owner, on-time, EGP amount', 'token from evaluation-service', '200', '401, 403, 404', 'service'],
  ['GET /internal/suppliers/:id/open-orders', 'For Supplier: number of open orders', 'token from supplier-service', '200', '401, 403', 'service'],
]));
c.push(H2('3.3 Evaluation Service - Karim (Lambda ses-evaluation-service)'));
c.push(api([
  ['POST /api/evaluations', 'F1 Rate own DELIVERED order once; overall = 0.4q + 0.3p + 0.3d; pushes new average to Supplier', 'orderId, scores 1-5 integers, comment <= 500', '201', '400, 401, 403, 404, 409', 'Staff'],
  ['GET /api/evaluations', 'F4 Rating history: supplier, mine, min overall, dates', 'filters', '200', '400, 401', 'Admin, Staff'],
  ['PUT /api/evaluations/:id', 'F5 Edit own rating within 7 days; recalculates average', 'scores; author only (others 404)', '200', '400, 401, 403, 404, 409', 'Staff (author)'],
  ['DELETE /api/evaluations/:id', 'F5 Delete own rating within 7 days', 'author only', '200', '401, 403, 404, 409', 'Staff (author)'],
  ['GET /api/performance/suppliers/:id', 'F2 Report: averages per criterion, on-time %, 90-day trend, distribution, EGP spend', 'id', '200', '401, 404', 'Admin, Staff'],
  ['GET /api/performance/compare', 'F3 Compare 2-5 suppliers, best per criterion, ranking', '2-5 ids', '200', '400, 401', 'Admin, Staff'],
  ['GET /api/rates/:currency, /api/rates/convert', 'F6 Rate to EGP / convert an amount (ExchangeRate API, cache)', 'currency allow-list, amount > 0', '200', '400, 401, 502', 'Admin, Staff'],
  ['POST /api/performance/suppliers/:id/sync', 'Re-send a supplier average if an earlier push failed', 'id', '200', '401, 403, 503', 'Admin'],
  ['POST /internal/convert', 'For Order and Supplier: convert and record in the EGP price ledger', 'tokens from order/supplier-service', '200', '400, 401, 403, 502', 'service'],
]));
c.push(H2('3.4 Auth Service - shared (lead Zeyad)'));
c.push(api([
  ['POST /api/auth/login', 'JWT (2 h) + server session; 5 failures -> 15 min lock-out; same message for unknown e-mail or wrong password', 'e-mail, password', '200', '400, 401, 415, 429', 'Public'],
  ['POST /api/auth/logout', 'Revoke session', 'token', '200', '401', 'Any'],
  ['GET /api/auth/me', 'Session still valid and account active?', 'token + session', '200', '401', 'Any'],
  ['POST /api/users', 'Create Staff account (no public sign-up; role cannot be sent)', 'e-mail unique, name, password 10-72 letters+digits', '201', '400, 401, 403, 409, 415', 'Admin'],
  ['GET /api/users, PATCH /api/users/:id/status', 'List / enable / disable accounts (disable revokes sessions; not yourself)', 'isActive boolean', '200', '400, 401, 403, 404, 409', 'Admin'],
  ['GET /api/admin/activity', 'Security monitoring: events per day, totals, suspicious sources (>= 5 in 15 min)', 'days 1-90', '200', '401, 403', 'Admin'],
]));
c.push(H2('3.5 Data model'));
c.push(image(path.join(ROOT, 'docs', 'diagrams', 'er-diagram.png'), { maxW: 620 }));
c.push(caption('Figure 2 - ER diagram: one schema per service, cross-service references checked through APIs'));
c.push(table(['Entity', 'Relationships', 'Operations', 'Service (DB role)'], [
  ['users, sessions', 'user 1:N sessions; created_by / rated_by in other schemas refer to users', 'C R U Q (no delete; disable)', 'Auth (auth_svc)'],
  ['activity_log', 'optional user_id', 'C by every service (INSERT only), R Q by Auth', 'all / Auth'],
  ['categories, suppliers', 'category 1:N suppliers', 'C R U Q, archive', 'Supplier (supplier_svc)'],
  ['supplier_contacts, contracts, status_history', 'supplier 1:N each', 'contacts C R D; contracts C R U; history C R', 'Supplier (supplier_svc)'],
  ['purchase_orders, order_status_history', 'order 1:N history; supplier_id / contract_id refer to Supplier (via API)', 'C R U Q + SUM/aggregates (no delete; cancel)', 'Order (order_svc)'],
  ['evaluations', 'order_id UNIQUE (1 per order); supplier_id refers to Supplier', 'C R U D Q + AVG/trend', 'Evaluation (evaluation_svc)'],
  ['price_conversions, rate_cache', 'source_id = order or contract', 'conversions C R Q; cache C R U', 'Evaluation (evaluation_svc)'],
], [24, 34, 24, 18]));

// 4 roles
c.push(H1('4. Role / permission matrix'));
c.push(table(['Action', 'Not logged in', 'Staff', 'Admin', 'Enforced where'], [
  ['Log in', 'Allowed', '-', '-', 'Auth Service; lock-out after 5 failures'],
  ['Search / view suppliers, contracts, recommendations', '401', 'Yes', 'Yes', 'authenticate + requireRole in supplier routes'],
  ['Create / update / archive suppliers, contacts, contracts, status', '401', '403', 'Yes', "requireRole('admin') in supplier-service/src/routes.js"],
  ['Raise a purchase order', '401', 'Yes', 'Yes', 'order routes; supplier eligibility rule'],
  ['View / deliver / cancel an order', '401', 'Own only (others 404)', 'All', 'loadOwnedOrder() in orderController.js'],
  ['Approve / reject an order', '401', '403', 'Yes, never own order (403)', "requireRole('admin') + segregation-of-duties check"],
  ['Submit a rating', '401', 'Own delivered orders, once', '403', "requireRole('staff') + Order ownership/status check + UNIQUE(order_id)"],
  ['Edit / delete a rating', '401', 'Own, within 7 days (others 404)', '403', 'loadOwnEvaluation() + edit window'],
  ['View reports, comparison, rates', '401', 'Yes', 'Yes', 'evaluation routes'],
  ['Create / disable accounts, view security monitoring', '401', '403', 'Yes (not self-disable)', "requireRole('admin') in auth routes"],
  ['Call /internal/* routes', 'Not published on API Gateway (404)', '401 (no service token)', '401', 'internalOnly([callers]) + IAM lambda:InvokeFunction allow-list'],
], [30, 12, 18, 16, 24]));
c.push(P('The role comes only from the signed JWT, never from the request body (creating a user with role=admin is rejected, test SEC-05). The frontend hides admin-only controls for convenience, but every decision is made again by the backend (tests SEC-03, SEC-04, screenshot 18).'));

// 5 external
c.push(H1('5. External integration'));
c.push(table(['Item', 'Detail'], [
  ['Service', 'ExchangeRate-API (exchangerate-api.com): v6 keyed endpoint when EXCHANGE_API_KEY is configured, otherwise the provider\'s open-access endpoint (same data, daily updates)'],
  ['Used by', 'Evaluation Service (Karim) - services/evaluation-service/src/exchangeRates.js'],
  ['Workflows it supports', 'Every foreign-currency purchase order (Order -> Evaluation POST /internal/convert) and contract (Supplier -> Evaluation) is converted to EGP; the EGP value drives the contract spending limit, the 50,000 EGP approval threshold, the spending summary, supplier comparison and the live EGP preview on the order form'],
  ['Data stored', 'amount_egp, rate_to_egp and rate_date on each order/contract; every conversion in evaluation.price_conversions; latest rates in evaluation.rate_cache'],
  ['Robustness', '5-second timeout; response validated (result = success, positive numeric rate for every allowed currency); 6-hour cache; if the provider fails the last cached rate (<= 7 days) is used and marked stale; otherwise 502 RATE_UNAVAILABLE and the order is still saved with conversion PENDING and sent for approval, then retried with POST /api/orders/:id/convert (tests RS-01..RS-05)'],
  ['Key storage', 'Never in code or the repository: EXCHANGE_API_KEY lives in the git-ignored .env.local locally and in the ses/evaluation-service secret in AWS Secrets Manager on Floci; only the Evaluation Lambda role can read that secret. The key is never logged (logs contain only the provider host).'],
], [22, 78]));

// 6 deployment
c.push(H1('6. Deployment approach'));
c.push(P('Cloud and service model: serverless on AWS, emulated with Floci as required by the module (the same AWS CLI commands deploy to a real AWS account). Each service is an AWS Lambda function (FaaS) behind its own Amazon API Gateway HTTP API; the website is an Amazon S3 static site; secrets are in AWS Secrets Manager; logs, metrics and alarms in CloudWatch; identities in IAM. The data layer is PostgreSQL running as a container on the Floci Docker network (Neon is supported by changing the connection settings only).'));
c.push(table(['Student', 'AWS services used for their own component'], [
  ['Zeyad (Supplier + shared auth/logging)', 'Lambda ses-supplier-service and ses-auth-service, API Gateway ses-supplier-service-api, IAM role ses-supplier-service-role, Secrets Manager ses/supplier-service, CloudWatch log groups + metric filters + alarms'],
  ['Ebraheem (Order + deployment)', 'Lambda ses-order-service, API Gateway ses-order-service-api, IAM role ses-order-service-role, Secrets Manager ses/order-service, CloudWatch Logs, S3 website bucket ses-web (deploy-frontend.sh)'],
  ['Karim (Evaluation + DB + external API)', 'Lambda ses-evaluation-service, API Gateway ses-evaluation-service-api, IAM role ses-evaluation-service-role, Secrets Manager ses/evaluation-service (incl. API key), CloudWatch Logs + ExchangeApiFailures metric'],
], [30, 70]));
c.push(H3('Why serverless suits this project'));
['Traffic is low and bursty (office hours): Lambda costs nothing when idle and scales per request, unlike an always-on EC2 server.',
  'Small team: no servers or OS patching; the same Express app runs locally (server.js) and on Lambda (lambda.js) exactly as in Lab 7.',
  'Feedback asked for independent deployment: one function, one API, one role and one secret per service makes each service deployable on its own (bash infra/deploy.sh order-service).',
  'Cost: free on Floci; on real AWS the free tier covers coursework traffic (see section 14).'].forEach((s) => c.push(B(s)));
c.push(H3('Trade-offs'));
['Cold starts (first request after idle is slower, about 1-2 s for loading secrets and connecting to Postgres).',
  'Lambda opens database connections per instance; we keep the pool at 2 per instance. At larger scale RDS Proxy or Neon pooling would be needed.',
  'More moving parts than one Vercel app (4 functions, 4 APIs) - handled with one scripted deployment (infra/deploy.sh) and per-service packaging.',
  'Floci is a local emulator: it does not enforce IAM by default, so the least-privilege policies are written and attached but only enforced on real AWS.'].forEach((s) => c.push(B(s)));
c.push(H3('Deployment steps and URLs'));
c.push(table(['Step', 'Command / result'], [
  ['Start Floci + Postgres', 'docker compose -f infra/floci/docker-compose.yml up -d  (docs/DOCKER_FLOCI_SETUP.md)'],
  ['Deploy everything', 'bash infra/deploy.sh all  -> DB roles/schemas, 4 x (secret, IAM role + policy, Lambda zip, HTTP API + routes + $default stage + invoke permission), CloudWatch filters and alarms, S3 website'],
  ['Deploy one service', 'bash infra/deploy.sh supplier-service | order-service | evaluation-service'],
  ['Smoke test', 'bash infra/check-deploy.sh  (health = lambda, internal route 404, 401 without token, CORS, website, config.js)'],
  ['Application URL', 'http://localhost:4566/ses-web/index.html'],
  ['API URLs', 'http://<api-id>.execute-api.localhost.floci.io:4566 for each service (written to infra/floci-urls.env)'],
], [22, 78]));
c.push(H3('Deployment evidence (Floci)'));
c.push(table(['Smoke check (bash infra/check-deploy.sh)'], checkDeploy.map((l) => [l]), [100], { size: 17 }));
c.push(gap());
c.push(...dash('02-lambda-functions.png', 'Floci Dash - the four Lambda functions (nodejs22.x, Active)'));
c.push(...dash('03-api-gateway.png', 'API Gateway on Floci (live AWS CLI output): the four HTTP APIs and their routes, a health check through each gateway (runtime lambda) and 404 from the gateway for /internal/*'));
c.push(...dash('04-secrets-manager.png', 'Floci Dash - one Secrets Manager secret per service (values never displayed)'));
c.push(...shot('03-admin-dashboard.png', 'The deployed application: website served from S3 (http://localhost:4566/ses-web), data from the Lambda functions', { maxH: 420 }));

// 7 threat model
c.push(H1('7. Threat model'));
c.push(table(['#', 'Threat', 'Category', 'Affected part', 'Implemented control', 'Test'], [
  ['T1', 'Password guessing against Staff accounts', 'Identity', 'POST /api/auth/login', 'scrypt hashes; same error for any failure; lock-out after 5 failures for 15 min; FailedLogins metric + alarm', 'AU-02, SEC-12'],
  ['T2', 'Stolen, forged or expired token used to call the API', 'Identity', 'All protected routes', 'HS256 JWT with issuer/audience/expiry checks (2 h), secret in Secrets Manager; logout/disable revoke the session; HTTPS on AWS', 'SEC-01, SEC-02, SEC-13'],
  ['T3', 'IDOR: a Staff user changes an id to read/change another user\'s order or rating', 'Data / API', 'Order and Evaluation services', 'Ownership check in the backend; other users\' records answer 404', 'SEC-06, SEC-07, OR-09'],
  ['T4', 'Privilege escalation: Staff calls Admin routes or sends role=admin', 'Identity / API', 'Supplier, Order approval, Auth', "requireRole() in every route; role only from the signed token; forbid('role'); segregation of duties for approvals", 'SEC-03, SEC-04, SEC-05, SEC-08'],
  ['T5', 'Rating manipulation (undelivered order, twice, out of range)', 'Application / Data', 'Evaluation Service', 'Order status + owner checked through the Order Service; UNIQUE(order_id); 1-5 checks in API and DB', 'EV-01, EV-03, EV-04'],
  ['T6', 'SQL injection through search or filters', 'API / Data', 'GET /api/suppliers, /api/orders', 'Parameterised queries only; allow-lists for status/currency; per-service DB role limits the damage', 'SEC-10, SEC-15'],
  ['T7', 'Stored XSS in a supplier name or rating comment', 'Application', 'Frontend pages', 'All user text rendered with textContent; Content-Security-Policy (script-src self, no inline); length limits', 'SEC-11, screenshot 17'],
  ['T8', 'Wrong / missing exchange rates or leaked API key', 'External API / Data', 'Evaluation Service', 'Response validation, timeout, cache + stale fallback, order saved with PENDING conversion; key only in Secrets Manager', 'RS-01..RS-06, EV-08'],
  ['T9', 'A compromised service reads or changes another service\'s data', 'Cloud configuration', 'Database, Lambda roles', 'One DB role per service on its own schema; IAM role per Lambda limited to own secret/log group and needed invokes; internal routes need a service token from an allowed caller', 'SEC-14, SEC-15, LT-06'],
  ['T10', 'Secrets committed to GitHub, CORS open to any origin, missing headers', 'Cloud configuration', 'Repository, API Gateway, Lambda', '.gitignore + secret scanner; exact CORS_ORIGINS; Helmet headers; internal routes not published on API Gateway', 'SEC-16, SEC-17, SEC-18'],
], [5, 19, 11, 15, 36, 14], { size: 16 }));

// 8 controls
c.push(H1('8. Security controls'));
c.push(table(['Control', 'How it is implemented', 'Code / config'], [
  ['Authentication', 'No public sign-up. Passwords hashed with scrypt (N=16384, random salt, constant-time compare). Login returns a 2-hour HS256 JWT bound to a server session (logout/disable revoke it). Lock-out after 5 failures.', 'auth-service/src/*, shared/auth.js'],
  ['Authorization', 'authenticate + requireRole on every route; ownership checks in controllers; segregation of duties for approvals; internalOnly() for service routes.', 'shared/auth.js, */src/routes.js'],
  ['Least privilege', 'Per-service DB roles with only needed table rights (no DELETE where the code never deletes, INSERT-only audit log, no DDL); per-Lambda IAM role: own log group, own secret, invoke only needed functions; S3 bucket only serves frontend files.', 'database/02_roles_grants.sql, infra/iam/*.json'],
  ['Secrets handling', 'Random secrets generated into git-ignored .env.local / infra/.env.floci; on Floci stored in Secrets Manager (one secret per service) and read at cold start with the function\'s role (no access keys in code); frontend has no secrets; secret scanner.', 'shared/config.js, infra/deploy.sh, scripts/secret-scan.js'],
  ['Input validation', 'Central Validator (required, type, length, range, e-mail, date, currency allow-list, UUID); forbidden client fields; 415 for non-JSON, 413 for > 50 KB; DB CHECK and UNIQUE constraints as a second line.', 'shared/validate.js, database/01_schemas.sql'],
  ['Ownership checks', 'Staff see only their orders; only the author edits/deletes a rating; rating requires being the order creator; other users\' ids answer 404.', 'orderController.loadOwnedOrder, evaluationController.loadOwnEvaluation'],
  ['Secure transport', 'HTTPS on real AWS API Gateway and S3/CloudFront; TLS to Neon (sslmode=require, certificate verified); HSTS header. Floci runs on localhost over HTTP (emulator limitation).', 'shared/db.js, Helmet'],
  ['Encryption at rest', 'Secrets Manager encrypts secrets (KMS on AWS); Neon/RDS storage encrypted at rest by the provider; passwords stored only as scrypt hashes; tokens never stored in the database or logs.', '-'],
  ['Logging', 'One JSON line per request (time, method, path, status, duration, user id, role) and per security event; never bodies, passwords, tokens or comments; security events also stored in audit.activity_log.', 'shared/logger.js'],
], [16, 60, 24]));
c.push(H2('Shared responsibility'));
c.push(table(['Cloud provider (AWS / Floci, Neon, ExchangeRate-API)', 'Our team'], [
  ['Physical data centres, hardware, network and the hypervisor', 'Secure application code: validation, authorization, ownership and business rules'],
  ['Running, patching and scaling the Lambda runtime, API Gateway and S3', 'IAM policies, DB roles and grants - choosing least privilege for every identity'],
  ['Encrypting Secrets Manager values and managed storage at rest; TLS certificates on AWS endpoints', 'Creating, storing and rotating our secrets (JWT secrets, DB passwords, API key) and keeping them out of Git'],
  ['Operating the managed PostgreSQL service (Neon) and the exchange-rate service', 'Configuration: CORS, published routes, headers, log retention, alarms; monitoring and responding to them'],
  ['Availability of CloudWatch and its storage', 'Testing, data backup/recovery procedures and incident response'],
], [50, 50]));
c.push(H3('Why broad administrative access is inappropriate'));
c.push(P('If any Lambda ran with AdministratorAccess or the Postgres owner account, one bug or injected request in that service could read every secret, delete every table or change IAM itself. With our policies a fully compromised Order function can only read ses/order-service, write its own logs, invoke the Supplier and Evaluation functions (which still check service tokens and business rules) and use order_svc, which cannot read suppliers, users or ratings and cannot delete orders (verified by test SEC-15). The Auth function cannot invoke any other function at all. Only the deployment lead uses the owner/administrator identity, and only to run migrations and deployments.'));

// 9 repo
c.push(H1('9. GitHub repository'));
c.push(Pb('Link: ', LINKS.repo));
c.push(table(['Folder', 'Contents', 'Owner'], [
  ['services/supplier-service', 'Supplier Service (app, lambda, routes, controller, internal routes)', 'Zeyad'],
  ['services/order-service', 'Order Service', 'Ebraheem'],
  ['services/evaluation-service', 'Evaluation Service + ExchangeRate integration', 'Karim'],
  ['services/auth-service, services/shared', 'Auth Service; shared auth, logging, validation, DB, service client', 'Zeyad (lead), all'],
  ['frontend/', 'Pages: suppliers/supplier (Zeyad), orders (Ebraheem), evaluations (Karim); shared login, dashboard, admin, api.js, ui.js, auth.js', 'per page'],
  ['database/', 'Schemas, per-service roles and grants, seed', 'Karim (DB setup lead)'],
  ['infra/', 'Floci compose, IAM policies, routes, deploy/monitoring/frontend/destroy/check scripts', 'Ebraheem (deployment lead), Zeyad (monitoring.sh)'],
  ['tests/, scripts/, evidence/, docs/', 'Automated tests, local runner, seeding, secret scan, log query, screenshots, report', 'all'],
], [28, 54, 18]));
c.push(table(['Repository / branch', 'Owner', 'Purpose'], [
  ['Team repository (public): ' + LINKS.repo, 'all', 'One repository with the complete source, configuration, report and evidence of all three members'],
  ['branch main', 'all', 'Integrated system; every member branch is merged through a reviewed pull request'],
  ['branch zeyad', 'Zeyad', 'Shared core, Auth Service and monitoring, Supplier Service and pages'],
  ['branch ebraheem', 'Ebraheem', 'Order Service and page, Floci deployment (infra/), Lambda packaging, test suite, report and evidence'],
  ['branch karim', 'Karim', 'Evaluation Service and page, database schemas/roles, resilience tests, seeding, diagrams'],
  ['Personal repository - Zeyad (public)', 'Zeyad', LINKS.personal.zeyad],
  ['Personal repository - Ebraheem (public)', 'Ebraheem', LINKS.personal.ebraheem],
  ['Personal repository - Karim (public)', 'Karim', LINKS.personal.karim],
], [34, 12, 54]));
c.push(P('Each member commits only their own files from their own GitHub account on their own branch, opens a pull request into main, and another member reviews it before merging; the personal repositories contain the same component with the same author, as individual proof of work (docs/GITHUB_SUBMISSION_GUIDE.md). .env files, node_modules, logs and build output are git-ignored, and node scripts/secret-scan.js is run before every push (result: 0 findings, test SEC-18). No credential has ever been committed, so no history rewrite is needed.'));

// 10 video
c.push(H1('10. Demo video'));
c.push(Pb('Link: ', LINKS.video));
c.push(P('The video (4 minutes 13 seconds, no commentary, on-screen captions) was recorded on the application deployed on Floci (website from S3, APIs through API Gateway and Lambda). Content, in order:'));
[['Main scenario', 'Admin signs in; registers supplier Giza Steel Works; adds a 50,000 USD contract converted to EGP through the Evaluation Service (ExchangeRate API); Staff raises a USD order (live EGP preview), which needs approval because it is above 50,000 EGP; Admin approves it; Staff marks it delivered; Staff rates it; the supplier profile shows the new score pushed by the Evaluation Service.'],
  ['Security scenarios', 'Generic message for a wrong password; Staff on the Admin area with the API answering 403; ownership check - another user\'s order by id answers 404; order refused for a supplier automatically put UNDER REVIEW (422); tampered rating score rejected (400); 5 wrong passwords lock the account (429).'],
  ['Monitoring and cloud', 'Admin security monitoring page (audit log); Floci Lambda functions; API Gateway HTTP APIs and routes (live CLI output); Secrets Manager; CloudWatch log groups; CloudWatch alarm ses-repeated-failed-logins in ALARM.'],
].forEach(([a, b]) => c.push(B(t(a + ': ', { bold: true }), t(b))));

// 11 logs
c.push(H1('11. Log and monitoring evidence'));
c.push(P(`The services write structured JSON logs (one line per request and per security event). On Floci/AWS these go to CloudWatch Logs (/aws/lambda/ses-<service>), where infra/monitoring.sh adds metric filters (FailedLogins, Http401, Http403, Http5xx, ExchangeApiFailures) and three alarms. The same rules were applied to the logs of the evidence run with scripts/log-query.js (average latency ${logs.latency} ms, p95 ${logs.p95} ms).`));
c.push(table(['Service', 'Requests', '2xx', '4xx', '401', '403', '404', '5xx'], Object.entries(logs.byServiceStatus).map(([s, v]) => [s, v.total, v['2xx'], v['4xx'], v['401'], v['403'], v['404'], v['5xx']]), [26, 11, 9, 9, 9, 9, 9, 9]));
c.push(gap());
c.push(table(['Alarm / filter', 'Rule', 'Observed', 'Interpretation'], [
  ['ses-repeated-failed-logins', 'FailedLogins >= 5 in 5 min', `${logs.failedWin.count} failed logins between ${String(logs.failedWin.start).slice(11, 19)} and ${String(logs.failedWin.end).slice(11, 19)} UTC -> ALARM`, 'Repeated failed logins from one source (the brute-force test SEC-12 plus AU-02). In production this means password guessing: check the source IP, the locked account and the AUTH_ACCOUNT_LOCKED events.'],
  ['ses-many-403', 'Http403 >= 10 in 5 min', `max ${logs.w403.count} in 5 min -> OK (below 10)`, 'The 403s came from the deliberate role tests (Staff calling admin routes, Admin rating, self-approval).'],
  ['ses-server-errors', 'Http5xx >= 1', '1 x 502 RATE_UNAVAILABLE -> ALARM', 'Caused on purpose in RS-03 (exchange-rate provider down and cache older than 7 days); EXTERNAL_API_FAILURE events show the reason without exposing the API key.'],
], [20, 18, 28, 34]));
c.push(gap());
c.push(P('Security events counted in the same run:'));
c.push(table(['Event', 'Count'], Object.entries(logs.securityEvents).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([e, n]) => [e, n]), [70, 30]));
c.push(gap());
c.push(P('Sample log lines (sanitised by design - no passwords, tokens, request bodies or comments):'));
logs.samples.slice(0, 4).forEach((s) => c.push(new Paragraph({ spacing: { after: 60 }, shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' }, children: [new TextRun({ text: JSON.stringify(s), font: 'Consolas', size: 15 })] })));
c.push(...shot('11-admin-security-monitoring.png', 'Screenshot 11 - Admin security monitoring page (audit.activity_log): failed logins, lock-outs, 403s, ownership denials, rate API failures', { maxH: 700 }));
c.push(H2('CloudWatch on Floci'));
c.push(P('On the deployed system the same JSON log lines arrive in CloudWatch Logs. The metric filters turned them into metrics, and the alarm ses-repeated-failed-logins changed from OK to ALARM when 5 or more failed logins happened within 5 minutes (security tests plus 6 deliberate wrong-password attempts against the Auth API). Output of the AWS CLI queries (evidence/floci/cloudwatch.txt):'));
const cwSection = (title) => { const i = cw.indexOf(title); if (i < 0) return ''; const rest = cw.slice(i + title.length); const j = rest.indexOf('\n== '); return (j < 0 ? rest : rest.slice(0, j)).trim(); };
const metricRows = []; let cur = null;
cwSection('== 3. Metrics (Sum per 5 minutes) from the metric filters').split(/\r?\n/).forEach((l) => { if (l.startsWith('-- ')) cur = l.slice(3); else if (cur && l.trim()) { const [ts, v] = l.split('\t'); if (Number(v) > 0) metricRows.push([cur, ts.slice(0, 16).replace('T', ' '), v]); } });
c.push(table(['Metric (from metric filter)', '5-minute period', 'Sum'], metricRows.length ? metricRows : [['(no non-zero datapoints)', '', '']], [50, 30, 20]));
c.push(gap());
c.push(table(['Alarm history: ses-repeated-failed-logins'], cwSection('== 5. Alarm history: ses-repeated-failed-logins').split(/\r?\n/).filter(Boolean).map((l) => [l.replace('\t', '  ')]), [100], { size: 17 }));
c.push(gap());
c.push(P('Log query { $.event = "AUTH_LOGIN_FAILED" } on /aws/lambda/ses-auth-service (latest events; only event type, reason, path, IP and status - never the e-mail address or password):'));
cwSection('== 1. Log query: failed logins in /aws/lambda/ses-auth-service  filter { $.event = "AUTH_LOGIN_FAILED" }').split(/\r?\n/).filter((l) => l.startsWith('{')).slice(0, 3).forEach((l) => c.push(new Paragraph({ spacing: { after: 60 }, shading: { type: ShadingType.CLEAR, fill: 'F1F5F9' }, children: [new TextRun({ text: l, font: 'Consolas', size: 15 })] })));
c.push(...dash('07-cloudwatch-metrics-alarms.png', 'Floci Dash - CloudWatch alarms: ses-repeated-failed-logins in ALARM'));
c.push(...dash('06-cloudwatch-logs.png', 'Floci Dash - CloudWatch log groups of the four functions (14-day retention)'));

// 12 security tests
c.push(H1('12. Security test table'));
c.push(P(`${tests.results.filter((r) => r.id.startsWith('SEC')).length} controlled security tests were run against our own system (tests/run-all.js). They include unauthenticated access (SEC-01, SEC-02), unauthorized role (SEC-03, SEC-04, SEC-05, SEC-08), invalid input (SEC-09, SEC-10, SEC-11), ownership/access (SEC-06, SEC-07) and a secret exposure review (SEC-18). Evidence = HTTP status and a trimmed response (tokens redacted).`));
const dep = Object.fromEntries(deployed.results.map((r) => [r.id, r.pass ? 'PASS' : 'FAIL']));
c.push(table(['ID', 'Scenario', 'Expected', 'Actual (local run)', 'Local', 'Floci', 'Evidence'], byIds('SEC').map((r) => [r.id, r.scenario, r.expected, r.actual, r.pass ? 'PASS' : 'FAIL', dep[r.id] || 'n/a*', r.evidence.length > 120 ? r.evidence.slice(0, 120) + '…' : r.evidence]), [7, 22, 15, 15, 6, 6, 29], { size: 15 }));
c.push(P('* SEC-14 (calling /internal routes directly) and SEC-18 (secret scan of the repository and log files) need local access. On Floci the internal routes are not published at all: API Gateway answers 404 (smoke check), which is stronger than the 401/403 the code returns.'));

// 13 integrated testing
c.push(H1('13. Integrated testing'));
c.push(P('Normal and invalid cases for each service and the end-to-end workflows across all three services. "Integration" rows exercise real calls between services.'));
c.push(H3('Functional, business-rule and integration tests'));
c.push(table(['ID', 'Owner', 'Scenario', 'Expected', 'Actual', 'Result'], tests.results.filter((r) => !r.id.startsWith('SEC')).map((r) => [r.id, r.owner, r.scenario, r.expected, r.actual, r.pass ? 'PASS' : 'FAIL']), [7, 13, 30, 22, 21, 7], { size: 15 }));
c.push(H3('Same tests against the deployed system on Floci'));
c.push(P(`tests/run-all.js was run with AUTH_API, SUPPLIER_API, ORDER_API and EVALUATION_API set to the four API Gateway URLs on Floci (run at ${deployed.runAt}): ${deployed.passed}/${deployed.results.length} passed. Every request went through API Gateway to the Lambda functions, and the cross-service calls used lambda:InvokeFunction.`));
c.push(table(['ID', 'Scenario', 'Result on Floci'], deployed.results.filter((r) => !r.id.startsWith('SEC')).map((r) => [r.id, r.scenario, r.pass ? 'PASS' : 'FAIL']), [10, 72, 18], { size: 15 }));
c.push(H3('Resilience (external API and service outages)'));
c.push(table(['ID', 'Scenario', 'Expected', 'Actual', 'Result'], resil.results.map((r) => [r.id, r.scenario, r.expected, r.actual, r.pass ? 'PASS' : 'FAIL']), [7, 35, 26, 24, 8], { size: 15 }));
c.push(H3('Packaged Lambda functions'));
c.push(table(['ID', 'Scenario', 'Expected', 'Actual', 'Result'], lambda.results.map((r) => [r.id, r.scenario, r.expected, r.actual, r.pass ? 'PASS' : 'FAIL']), [7, 35, 26, 24, 8], { size: 15 }));
c.push(H3('How errors are handled'));
['Every error returns the same JSON shape with a code; the frontend shows the message and the per-field details next to the form (screenshots 06, 15, 17).',
  'Unexpected errors return a generic 500 and the technical detail is only logged (never sent to the browser).',
  'If a dependency is down the caller answers 503 DEPENDENCY_UNAVAILABLE; for conversions the order is still saved (PENDING) and can be retried.',
  'All state-changing workflows (status changes, approvals, delivery) run inside database transactions with row locks (SELECT ... FOR UPDATE).'].forEach((s) => c.push(B(s)));
c.push(H3('Limitations of the testing'));
['Resilience tests (provider outage, dependency down) were run on the local integrated deployment, because they start extra service instances with a broken dependency; the normal and security tests were run on both the local run and Floci.',
  'No load test was run; scaling statements in section 14 are based on the service limits and the measured average latency.',
  'Floci does not enforce IAM by default, so IAM denials can only be demonstrated on real AWS.'].forEach((s) => c.push(B(s)));

// 14 cost
c.push(H1('14. Cost / resource statement'));
c.push(table(['Resource', 'Use', 'How unnecessary cost is avoided'], [
  ['4 Lambda functions (256 MB, 15 s timeout)', 'Run only per request', 'No idle cost; small memory; short timeout stops runaway invocations; dependencies shared in one small zip (3.8 MB)'],
  ['4 API Gateway HTTP APIs', 'Public routes', 'HTTP APIs (cheaper than REST APIs); throttling 20 req/s, burst 50 limits abuse'],
  ['PostgreSQL (container / Neon free plan)', 'All persistent data', 'Small pool (2 connections per Lambda); indexes on filter columns; pagination (max 100 rows)'],
  ['ExchangeRate API', 'Rates', 'Rates cached 6 hours -> at most ~4 provider calls per day regardless of traffic (free-plan quota)'],
  ['CloudWatch Logs', 'Logs, metrics, alarms', '14-day retention; compact one-line JSON logs; no request bodies'],
  ['S3 website', 'Static files', 'A few KB of files; no server'],
  ['Secrets Manager', '4 secrets', 'One secret per service (not per value); read once per cold start'],
], [26, 18, 56]));
c.push(P('On Floci everything is free. On a real AWS account this traffic (a few thousand requests a month) stays inside the always-free Lambda (1 million requests) and the API Gateway/S3 free tiers; Secrets Manager (about USD 0.40 per secret per month) is the only small fixed cost. With more load, Lambda and API Gateway scale automatically per request; the database is the limit, handled by the small pools, then Neon autoscaling or RDS Proxy, read-heavy endpoints (search, reports) could be cached, and the reserved concurrency of each function can cap database connections.'));

// 15 recovery
c.push(H1('15. Recovery approach'));
c.push(table(['Situation', 'How we restore or recreate'], [
  ['Application or configuration deleted / misconfigured', 'Everything is code: bash infra/deploy.sh all recreates secrets, roles, policies, functions, APIs, alarms and the website in minutes; bash infra/destroy.sh + deploy.sh gives a clean environment.'],
  ['Database schema or roles damaged', 'node scripts/db-setup.js is idempotent: recreates schemas, tables, roles and grants without touching existing rows.'],
  ['Data deleted by mistake', 'Business records are never hard-deleted (suppliers archived, orders cancelled, accounts disabled); status history tables show who changed what. Neon point-in-time restore / branch from before the incident, or pg_dump nightly backup of the Postgres container (docker exec ses-postgres pg_dump ... > backup.sql) restored with psql.'],
  ['Secret leaked (DB password, JWT secret, API key)', 'Rotate at the source (ALTER ROLE ... PASSWORD, new random JWT secret, new API key), update the value in infra/.env.floci and run deploy.sh (new Secrets Manager version, functions pick it up on next cold start); changing JWT_SECRET logs everybody out; check the activity log for misuse.'],
  ['Compromised account', 'Admin disables it (all its sessions are revoked immediately); lock-out events and the activity log show what it did.'],
  ['Secret deleted by mistake', 'destroy.sh uses a 7-day recovery window, so aws secretsmanager restore-secret recovers it.'],
], [28, 72]));

// 16 limitations
c.push(H1('16. Limitations'));
c.push(table(['Residual risk / missing control', 'Reason', 'Proposed improvement'], [
  ['A revoked session token is still accepted by the Supplier/Order/Evaluation services until it expires (max 2 h)', 'Services verify the JWT locally to stay independent and avoid an extra call per request', 'Shorter access tokens with refresh tokens, or a revocation list cached from the Auth Service'],
  ['Token kept in sessionStorage (readable by JavaScript if XSS ever happened)', 'APIs are on different origins than the site, so cookies would need extra cross-site configuration', 'Put the APIs behind one domain (CloudFront) and use HttpOnly, Secure, SameSite cookies; CSP already limits XSS'],
  ['Floci runs on HTTP and does not enforce IAM', 'Emulator limitation', 'Deploy the same scripts to a real AWS account (HTTPS and IAM enforcement), add CloudFront + ACM for the website'],
  ['Only one Admin is created automatically; an Admin\'s own large orders need another Admin', 'Admin accounts are created only by the setup script (no admin escalation through the API)', 'Add a controlled "promote to admin" flow requiring two admins'],
  ['No MFA', 'Out of scope for the coursework timeline', 'TOTP-based MFA for Admin accounts (or Cognito)'],
  ['Exchange rates are daily rates from one provider', 'Free plan', 'Second provider as fallback; store the official central-bank rate for contracts'],
  ['No automated backups configured for the local Postgres container', 'Emulated environment', 'Use Neon (point-in-time restore) or RDS automated backups in production'],
  ['No CI pipeline yet', 'Time', 'GitHub Actions: secret scan, tests and packaging on every pull request'],
], [34, 30, 36]));

// responsibility + demo plan
c.push(H1('Responsibility matrix'));
c.push(table(['Student', 'Owned component', 'Functions', 'Security responsibilities', 'Repository evidence'], [
  ['Zeyad (239924)', 'Supplier Service + shared Auth & logging', 'Create, search/filter, update, details, contracts (rules + EGP), status workflow + auto review, recommendations, archive with open-order check; login/lock-out, staff accounts, monitoring', 'Admin-only writes, input validation, supplier_svc grants, JWT/scrypt/lock-out, logger + CloudWatch filters/alarms', 'Branch zeyad: services/supplier-service, auth-service, shared, frontend suppliers/supplier/admin, infra/monitoring.sh; personal repository'],
  ['Ebraheem (249043)', 'Order Service + cloud deployment', 'Create PO with eligibility/limit/approval, list/filter, details, delivery workflow, approval with segregation of duties, spending summary, conversion retry', 'Ownership checks, status-transition rules, self-approval block, order_svc grants, IAM roles/policies, deployment scripts', 'Branch ebraheem: services/order-service, frontend orders, infra/ (deploy, IAM, Floci), tests, report; personal repository'],
  ['Karim (249581)', 'Evaluation Service + DB setup + external API', 'Rate delivered order, history, edit/delete own rating, performance report, compare, rates/convert, internal convert, score push', 'Rating validation, author-only changes, staff-only rating, API key in Secrets Manager, response validation, evaluation_svc grants, DB roles', 'Branch karim: services/evaluation-service, frontend evaluations, database/, scripts/db-setup.js, resilience tests; personal repository'],
], [12, 16, 28, 22, 22], { size: 16 }));
c.push(H1('Demo plan (live demonstration)'));
['Group overview (2 min): problem, users, architecture diagram, Floci serverless approach, who owns which service.',
  'End-to-end scenario on the deployed app: Admin creates a supplier and USD contract -> Staff raises an order (EGP preview) -> large order approved by Admin -> Staff marks it delivered -> Staff rates it -> supplier score and report update.',
  'Zeyad: Supplier functions incl. overlapping contract (409), recommendations, archive refused with open orders, automatic UNDER_REVIEW; auth lock-out; monitoring page and CloudWatch alarm.',
  'Ebraheem: Order functions incl. contract limit (422), approval and self-approval block (403), delivery on-time calculation, IDOR attempt (404), deploy.sh for one service and Floci Dash.',
  'Karim: Evaluation functions incl. rating an undelivered order (409), duplicate rating (409), invalid score (400), compare, converter, provider outage -> cached rate (stale) and EXTERNAL_API_FAILURE logs.',
  'Security selection: unauthenticated 401, Staff on admin route 403, invalid input 400, secret scan, least-privilege DB role test (SEC-15).'].forEach((s, i) => c.push(P(t(`${i + 1}. `, { bold: true }), t(s))));

// Individual statements
c.push(pageBreak());
c.push(H1('Individual Contribution Statements'));
const statement = (name, id, comp, rows, shots) => {
  c.push(H2(`${name} (${id}) - ${comp}`));
  c.push(table(['Area', 'Contribution'], rows, [20, 80], { size: 18 }));
  c.push(gap());
  shots.forEach(([f, cap]) => c.push(...shot(f, cap, { maxH: 420 })));
  const who = comp.startsWith('Supplier') ? 'zeyad' : comp.startsWith('Order') ? 'ebraheem' : 'karim';
  c.push(P(t('Repository evidence: ', { bold: true }), t(`team repository ${branchLink(who)}; pull request from ${who} into main; personal repository ${LINKS.personal[who]}.`)));
};
statement('Zeyad Ahmed Abdelaziz Abdelmaksoud El Gohary', '239924', 'Supplier Service (+ shared authentication and logging lead)', [
  ['Owned component & functions', 'Supplier Service: F1 create supplier profile, F2 search/filter, F3 update details, F4 view details, F5 contract management (overlap + date rules, EGP conversion through the Evaluation Service), F6 status workflow with history and automatic UNDER_REVIEW rule, F7 recommendations, F8 archive refused while the Order Service reports open orders. Shared: Auth Service (login, logout, me, Staff accounts, lock-out, activity monitor).'],
  ['Frontend', 'suppliers.html/js (search, filters, pagination, recommendations, create supplier + category), supplier.html/js (profile, contracts, contacts, status history, edit, status change, archive, performance panel from the Evaluation API), login.js, auth.js navigation, admin.html/js.'],
  ['Backend / API', 'supplier-service/src/routes.js, supplierController.js, internalRoutes.js (eligibility, performance); shared/auth.js (JWT, requireRole, service tokens), auth-service.'],
  ['Data operations', 'supplier schema: categories (C R), suppliers (C R U Q, soft archive), supplier_contacts (C R D), contracts (C R U), status_history (C R); auth.users/sessions; role supplier_svc without DELETE on suppliers.'],
  ['Security controls', 'Admin-only writes enforced in the backend, central validation, unique names, forbidden client fields, internal routes restricted to order-service/evaluation-service, scrypt + lock-out, JWT verification, logger without sensitive values, CloudWatch metric filters and alarms.'],
  ['Tests', 'SU-01..SU-11, IN-02, IN-03, AU-01..AU-04, SEC-01..SEC-05, SEC-12, SEC-13, SEC-16, SEC-17.'],
  ['Integration', 'Consumes Order (open orders) and Evaluation (contract conversion); serves Order (eligibility) and Evaluation (performance push); shared login and navigation used by all pages.'],
  ['Key decisions', 'Archive instead of delete to keep order history valid; supplier status decides order eligibility so evaluations have a real effect; JWT verified locally to keep services independent.'],
  ['Difficulties & solutions', 'Avoiding direct reads of other services\' tables after the split -> eligibility and performance exposed as internal endpoints with service tokens. Date handling shifted by time zones -> DATE columns returned as plain strings. On Floci the CloudWatch JSON metric filters matched nothing because the Lambda Node.js runtime prefixes console.log lines with timestamp and request id -> the logger writes raw JSON lines to stdout, after which the FailedLogins/Http403 metrics and the alarm worked.'],
], [['07-supplier-detail-contracts-performance.png', 'Supplier details with contracts (EGP), contacts, history and the Evaluation performance panel'], ['08-supplier-auto-under-review-history.png', 'Automatic UNDER_REVIEW after 3 poor ratings']]);
statement('Ebraheem Mohamed Ebraheem Mohamed Amin', '249043', 'Order Service (+ cloud deployment lead)', [
  ['Owned component & functions', 'Order Service: F1 create purchase order (Supplier eligibility, EGP conversion, contract limit, approval threshold), F2 list/filter (own orders for Staff), F3 details with history, F4 delivery workflow with on-time and days-late calculation and cancellation rules, F5 approve/reject with segregation of duties, F6 spending summary per supplier and month, F7 retry pending conversion.'],
  ['Frontend', 'orders.html/js: order form with live EGP preview, filters, pagination, actions (deliver, cancel, approve, reject, retry, rate link), order details and history, spending summary tables.'],
  ['Backend / API', 'order-service/src/routes.js, orderController.js, internalRoutes.js (order details for Evaluation, open-order count for Supplier).'],
  ['Data operations', 'orders.purchase_orders (C R U Q, SUM/AVG aggregates, no delete), order_status_history (C R), order number sequence; role order_svc.'],
  ['Security controls', 'Ownership check (other users\' orders 404), status transitions validated in transactions with row locks, self-approval blocked (403), admin-only approval, validation of quantities/prices/dates/currency, IAM roles and policies, deployment without secrets in code.'],
  ['Tests', 'OR-01..OR-10, RS-04, RS-05, SEC-06, SEC-08, LT-01..LT-06 (deployment packages).'],
  ['Integration', 'Calls Supplier (eligibility) and Evaluation (conversion); serves Evaluation (delivered status) and Supplier (open orders). Deployment: infra/deploy.sh, deploy-frontend.sh, Floci compose, check-deploy.sh, package-lambda.js.'],
  ['Key decisions', 'Never lose an order because the rate service is down (PENDING + approval); orders cannot be deleted, only cancelled; one Lambda/API/role per service for independent deployment.'],
  ['Difficulties & solutions', 'Windows Git Bash path conversion broke AWS CLI file:// arguments -> scripts run from the project folder with relative paths. Contract limit needs EGP on both sides -> unknown values force admin approval.'],
], [['09-orders-admin-approvals-summary.png', 'Admin order view with approvals and spending summary'], ['13-order-form-live-egp-conversion.png', 'Order form with live EGP conversion from the Evaluation Service']]);
statement('Karim Hisham Ebrahim Abdelbaset Mohamed', '249581', 'Evaluation Service (+ database setup and external API lead)', [
  ['Owned component & functions', 'Evaluation Service: F1 rate a delivered order (status and ownership checked with the Order Service, one per order, weighted score, pushes average to Supplier), F2 supplier performance report, F3 compare 2-5 suppliers, F4 rating history with filters, F5 edit/delete own rating within 7 days, F6 rates and conversion with the ExchangeRate API (+ internal conversion for Order and Supplier).'],
  ['Frontend', 'evaluations.html/js: rating form (only own delivered, unrated orders), edit/delete, history filters, comparison table with best per criterion, currency converter.'],
  ['Backend / API', 'evaluation-service/src/routes.js, evaluationController.js, exchangeRates.js, internalRoutes.js.'],
  ['Data operations', 'evaluation.evaluations (C R U D Q, AVG/trend/distribution), price_conversions (C R Q - EGP ledger), rate_cache (C R U); database/ schema and per-service roles (DB setup lead), scripts/db-setup.js.'],
  ['Security controls', 'Staff-only rating, author-only changes (404 for others), score ranges in API and DB, UNIQUE(order_id), API key only in Secrets Manager / env, provider response validation, timeout and fallback, EXTERNAL_API_FAILURE events.'],
  ['Tests', 'EV-01..EV-10, IN-01, RS-01..RS-03, RS-06, SEC-07, SEC-15.'],
  ['Integration', 'Calls Order (delivered/owner) and Supplier (performance push); serves conversions to Order and Supplier; performance panel on the supplier page.'],
  ['Key decisions', 'Conversion lives where the rates are managed, but the EGP values are stored with each order/contract; cache + stale fallback instead of failing; weights 40/30/30 favour quality.'],
  ['Difficulties & solutions', 'Proving outage handling without breaking the real provider -> extra service instances pointed at an unreachable / invalid provider in the resilience tests. Keeping one rating per order under concurrency -> UNIQUE constraint mapped to 409.'],
], [['10-evaluations-compare-admin.png', 'Supplier comparison (best per criterion)'], ['16-evaluations-staff-rate-history-converter.png', 'Staff rating form, history and ExchangeRate converter']]);

// appendix screenshots
c.push(pageBreak());
c.push(H1('Appendix A - Screenshots of the deployed application (Floci)'));
const shotsList = fs.readdirSync(path.join(ROOT, 'evidence', SHOTS)).filter((f) => f.endsWith('.png'));
shotsList.forEach((f) => c.push(...shot(f, `Screenshot ${f.slice(0, 2)} - ${f.slice(3, -4).replace(/-/g, ' ')}`, { maxH: 520 })));
c.push(H1('Appendix B - References'));
['Amazon Web Services (2025) AWS Lambda Developer Guide. Available at: https://docs.aws.amazon.com/lambda/ (Accessed: 21 November 2026).',
  'Amazon Web Services (2025) Amazon API Gateway Developer Guide - HTTP APIs. Available at: https://docs.aws.amazon.com/apigateway/ (Accessed: 21 November 2026).',
  'Amazon Web Services (2025) AWS Secrets Manager User Guide. Available at: https://docs.aws.amazon.com/secretsmanager/ (Accessed: 21 November 2026).',
  'Amazon Web Services (2025) Shared Responsibility Model. Available at: https://aws.amazon.com/compliance/shared-responsibility-model/ (Accessed: 21 November 2026).',
  'ExchangeRate-API (2025) Documentation. Available at: https://www.exchangerate-api.com/docs (Accessed: 21 November 2026).',
  'Floci (2025) Floci - local AWS emulator documentation. Available at: https://floci.io (Accessed: 21 November 2026).',
  'OWASP Foundation (2021) OWASP Top 10:2021. Available at: https://owasp.org/Top10/ (Accessed: 21 November 2026).',
  'OWASP Foundation (2023) OWASP API Security Top 10. Available at: https://owasp.org/API-Security/ (Accessed: 21 November 2026).',
  'PostgreSQL Global Development Group (2025) PostgreSQL 16 Documentation - Privileges. Available at: https://www.postgresql.org/docs/16/ddl-priv.html (Accessed: 21 November 2026).',
  'Module labs 1-7, Cloud Computing and Cloud Security 26CSCN29H (2026): REST API design, Express API, Vercel/Neon, API Gateway/S3 and Lambda/DynamoDB/IAM on Floci.'].forEach((r) => c.push(B(r)));

// static contents list (section titles)
c.splice(TOC_AT, 0, new Paragraph({ spacing: { after: 160 }, children: [t('Contents', { size: 32, bold: true, color: '12302D' })] }),
  ...H1_TITLES.map((h) => new Paragraph({ spacing: { after: 50 }, children: [t(h, { size: 21 })] })));

// ---------------------------------------------------------------- document
const doc = new Document({
  creator: 'Group 26', title: 'Supplier Directory & Evaluation System - Final Report',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 32, bold: true, color: '12302D' }, paragraph: { spacing: { before: 360, after: 160 }, keepNext: true, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 26, bold: true, color: '0F766E' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size: 23, bold: true, color: '334155' }, paragraph: { spacing: { before: 200, after: 80 }, keepNext: true, outlineLevel: 2 } },
    ],
  },
  numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  sections: [{
    properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1300, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t('Group 26 - Supplier Directory & Evaluation System - 26CSCN29H', { size: 16, color: '64748B' })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 16, color: '64748B' })] })] }) },
    children: c,
  }],
});

const out = path.join(__dirname, 'Group26_Final_Report.docx');
Packer.toBuffer(doc).then((raw) => {
  // drop ZIP folder entries (they break opening through cloud co-editing services)
  const AdmZip = require('adm-zip'); const src = new AdmZip(raw); const z = new AdmZip();
  src.getEntries().filter((e) => !e.isDirectory).forEach((e) => z.addFile(e.entryName, e.getData()));
  const buf = z.toBuffer(); fs.writeFileSync(out, buf); console.log('written', path.relative(ROOT, out), (buf.length / 1048576).toFixed(1) + ' MB'); });

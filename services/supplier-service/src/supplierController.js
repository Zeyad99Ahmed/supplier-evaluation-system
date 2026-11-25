// Supplier Service - owner: Zeyad Ahmed (239924)
// Business capability: keep the supplier directory (profiles, categories, contacts, contracts) and decide
// which suppliers may receive orders.
//
// Functions (Phase 1 + the two-plus extra functions requested in the feedback):
//   F1 Create supplier profile                    POST   /api/suppliers                 (admin)
//   F2 Search / filter suppliers                  GET    /api/suppliers                 (admin, staff)
//   F3 Update supplier details                    PUT    /api/suppliers/:id             (admin)
//   F4 View supplier details (contacts/contracts) GET    /api/suppliers/:id             (admin, staff)
//   F5 Contract management with business rules   POST   /api/suppliers/:id/contracts, PATCH /api/contracts/:id (admin)
//        - end date after start, no overlapping active contracts, value converted to EGP by the
//          Evaluation Service (ExchangeRate API) so contracts can be compared and order limits enforced
//   F6 Supplier status workflow                   PATCH  /api/suppliers/:id/status      (admin)
//        - allowed transitions only, reason required, full history; automatic UNDER_REVIEW when the
//          Evaluation Service reports a poor average score
//   F7 Supplier recommendations                   GET    /api/suppliers/recommendations (admin, staff)
//        - eligible suppliers in a category ranked by evaluation score and on-time rate
//   F8 Archive supplier                           DELETE /api/suppliers/:id             (admin)
//        - refused while the Order Service reports open orders for the supplier
//   + contacts (add/remove), categories, and internal endpoints used by Order and Evaluation.

const {
  db, validate, assertUuid, today, pagination, callService, securityEvent,
  AppError, notFound, conflict, badRequest,
} = require('../../shared');

const STATUSES = ['ACTIVE', 'UNDER_REVIEW', 'SUSPENDED', 'ARCHIVED'];
// Allowed manual transitions (ARCHIVED only via DELETE, and it is final).
const TRANSITIONS = {
  ACTIVE: ['UNDER_REVIEW', 'SUSPENDED'],
  UNDER_REVIEW: ['ACTIVE', 'SUSPENDED'],
  SUSPENDED: ['ACTIVE', 'UNDER_REVIEW'],
  ARCHIVED: [],
};
const LOW_SCORE = () => Number(process.env.LOW_SCORE_THRESHOLD || 2.5);
const MIN_RATINGS_FOR_REVIEW = () => Number(process.env.MIN_RATINGS_FOR_REVIEW || 3);

const supplierDto = (r) => ({
  id: r.id, name: r.name, categoryId: r.category_id, category: r.category_name, email: r.email, phone: r.phone,
  address: r.address, country: r.country, status: r.status, statusReason: r.status_reason,
  performance: { avgScore: r.avg_score === null ? null : Number(r.avg_score), ratingCount: r.rating_count,
    onTimeRate: r.on_time_rate === null ? null : Number(r.on_time_rate), updatedAt: r.score_updated_at },
  hasCurrentContract: r.has_current_contract === undefined ? undefined : Boolean(r.has_current_contract),
  createdAt: r.created_at, updatedAt: r.updated_at,
});

const contractDto = (c) => ({
  id: c.id, supplierId: c.supplier_id, title: c.title, startDate: fmtDate(c.start_date), endDate: fmtDate(c.end_date),
  value: Number(c.value), currency: c.currency, valueEgp: c.value_egp === null ? null : Number(c.value_egp),
  rateToEgp: c.rate_to_egp === null ? null : Number(c.rate_to_egp), rateDate: fmtDate(c.rate_date), status: c.status,
  isCurrent: c.status === 'ACTIVE' && fmtDate(c.start_date) <= today() && fmtDate(c.end_date) >= today(),
});

function fmtDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const off = d.getTimezoneOffset() * 60000; // pg returns DATE as local midnight
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

const SUPPLIER_SELECT = `
  SELECT s.*, c.name AS category_name,
         EXISTS (SELECT 1 FROM supplier.contracts k WHERE k.supplier_id = s.id AND k.status = 'ACTIVE'
                  AND k.start_date <= CURRENT_DATE AND k.end_date >= CURRENT_DATE) AS has_current_contract
    FROM supplier.suppliers s JOIN supplier.categories c ON c.id = s.category_id`;

async function loadSupplier(id, client = db) {
  const { rows } = await client.query(`${SUPPLIER_SELECT} WHERE s.id = $1`, [id]);
  return rows[0];
}

async function categoryExists(id) {
  const { rowCount } = await db.query('SELECT 1 FROM supplier.categories WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------- categories
async function listCategories(req, res) {
  const { rows } = await db.query(
    `SELECT c.id, c.name, count(s.id) FILTER (WHERE s.status <> 'ARCHIVED')::int AS supplier_count
       FROM supplier.categories c LEFT JOIN supplier.suppliers s ON s.category_id = c.id
      GROUP BY c.id ORDER BY c.name`);
  res.status(200).json({ categories: rows.map((r) => ({ id: r.id, name: r.name, supplierCount: r.supplier_count })) });
}

async function createCategory(req, res) {
  const { name } = validate(req.body).string('name', { required: true, min: 2, max: 60 }).done();
  const dup = await db.query('SELECT 1 FROM supplier.categories WHERE lower(name) = lower($1)', [name]);
  if (dup.rowCount) throw conflict('CATEGORY_EXISTS', 'This category already exists.');
  const { rows } = await db.query('INSERT INTO supplier.categories (name) VALUES ($1) RETURNING id, name', [name]);
  res.status(201).json({ category: rows[0] });
}

// ---------------------------------------------------------------- F1 create
function supplierFields(body, { partial = false } = {}) {
  const required = !partial;
  return validate(body)
    .string('name', { required, min: 2, max: 120 })
    .number('categoryId', { required, integer: true, min: 1 })
    .email('email', { required })
    .phone('phone')
    .string('address', { max: 200 })
    .string('country', { max: 60 })
    .forbid('status', 'avgScore', 'ratingCount', 'createdBy', 'id');
}

async function createSupplier(req, res) {
  const v = supplierFields(req.body);
  // optional first contact in the same request
  const contact = req.body && req.body.contact;
  if (contact !== undefined) {
    const cv = validate(contact).string('name', { required: true, min: 2, max: 100 }).string('jobTitle', { max: 80 }).email('email').phone('phone');
    cv.errors.forEach((e) => v.fail(`contact.${e.field}`, e.message));
    v.out.contact = cv.out;
  }
  const body = v.done();
  if (!(await categoryExists(body.categoryId))) throw badRequest('Some fields are invalid.', [{ field: 'categoryId', message: 'Category does not exist.' }]);
  const dup = await db.query('SELECT 1 FROM supplier.suppliers WHERE lower(name) = lower($1)', [body.name]);
  if (dup.rowCount) throw conflict('SUPPLIER_EXISTS', 'A supplier with this name already exists.');

  const id = await db.withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO supplier.suppliers (name, category_id, email, phone, address, country, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [body.name, body.categoryId, body.email.toLowerCase(), body.phone || null, body.address || null, body.country || null, req.user.id]);
    await tx.query(`INSERT INTO supplier.status_history (supplier_id, from_status, to_status, reason, changed_by) VALUES ($1, NULL, 'ACTIVE', 'Created', $2)`, [rows[0].id, req.user.id]);
    if (body.contact) {
      await tx.query('INSERT INTO supplier.supplier_contacts (supplier_id, name, job_title, email, phone) VALUES ($1,$2,$3,$4,$5)',
        [rows[0].id, body.contact.name, body.contact.jobTitle || null, body.contact.email || null, body.contact.phone || null]);
    }
    return rows[0].id;
  });
  res.status(201).json({ supplier: supplierDto(await loadSupplier(id)) });
}

// ---------------------------------------------------------------- F2 search / filter
async function searchSuppliers(req, res) {
  const q = req.query;
  const v = validate(q)
    .string('search', { max: 60 })
    .number('categoryId', { integer: true, min: 1 })
    .oneOf('status', STATUSES)
    .number('minScore', { min: 0, max: 5 })
    .oneOf('sort', ['name', 'score', 'newest'])
    .done();
  const { limit, offset, page } = pagination(q);
  const params = [v.search || '', v.categoryId || null, v.status || null, v.minScore === undefined ? null : v.minScore];
  const where = `WHERE ($1 = '' OR s.name ILIKE '%' || $1 || '%' OR s.email ILIKE '%' || $1 || '%')
      AND ($2::int IS NULL OR s.category_id = $2)
      AND (CASE WHEN $3::text IS NULL THEN s.status <> 'ARCHIVED' ELSE s.status = $3 END)
      AND ($4::numeric IS NULL OR s.avg_score >= $4)`;
  const order = { name: 's.name ASC', score: 's.avg_score DESC NULLS LAST, s.name', newest: 's.created_at DESC' }[v.sort || 'name'];
  const total = await db.query(`SELECT count(*)::int AS n FROM supplier.suppliers s ${where}`, params);
  const { rows } = await db.query(`${SUPPLIER_SELECT} ${where} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`, params);
  res.status(200).json({ suppliers: rows.map(supplierDto), page, limit, total: total.rows[0].n });
}

// ---------------------------------------------------------------- F4 details
async function getSupplier(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const s = await loadSupplier(id);
  if (!s) throw notFound('Supplier');
  const [contacts, contracts, history] = await Promise.all([
    db.query('SELECT * FROM supplier.supplier_contacts WHERE supplier_id = $1 ORDER BY created_at', [id]),
    db.query('SELECT * FROM supplier.contracts WHERE supplier_id = $1 ORDER BY start_date DESC', [id]),
    db.query('SELECT from_status, to_status, reason, changed_by, changed_at FROM supplier.status_history WHERE supplier_id = $1 ORDER BY id DESC LIMIT 20', [id]),
  ]);
  res.status(200).json({
    supplier: supplierDto(s),
    contacts: contacts.rows.map((c) => ({ id: c.id, name: c.name, jobTitle: c.job_title, email: c.email, phone: c.phone })),
    contracts: contracts.rows.map(contractDto),
    statusHistory: history.rows.map((h) => ({ from: h.from_status, to: h.to_status, reason: h.reason, changedBy: h.changed_by, changedAt: h.changed_at })),
  });
}

// ---------------------------------------------------------------- F3 update
async function updateSupplier(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const body = supplierFields(req.body).done(); // PUT = full replacement of editable fields
  const current = await loadSupplier(id);
  if (!current) throw notFound('Supplier');
  if (current.status === 'ARCHIVED') throw conflict('SUPPLIER_ARCHIVED', 'Archived suppliers cannot be edited.');
  if (!(await categoryExists(body.categoryId))) throw badRequest('Some fields are invalid.', [{ field: 'categoryId', message: 'Category does not exist.' }]);
  const dup = await db.query('SELECT 1 FROM supplier.suppliers WHERE lower(name) = lower($1) AND id <> $2', [body.name, id]);
  if (dup.rowCount) throw conflict('SUPPLIER_EXISTS', 'A supplier with this name already exists.');
  await db.query(
    `UPDATE supplier.suppliers SET name=$2, category_id=$3, email=$4, phone=$5, address=$6, country=$7, updated_at=now() WHERE id=$1`,
    [id, body.name, body.categoryId, body.email.toLowerCase(), body.phone || null, body.address || null, body.country || null]);
  res.status(200).json({ supplier: supplierDto(await loadSupplier(id)) });
}

// ---------------------------------------------------------------- F6 status workflow
async function changeStatus(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const body = validate(req.body)
    .oneOf('status', ['ACTIVE', 'UNDER_REVIEW', 'SUSPENDED'], { required: true })
    .string('reason', { required: true, min: 5, max: 300 })
    .done();
  const result = await db.withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT status FROM supplier.suppliers WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Supplier');
    const from = rows[0].status;
    if (!TRANSITIONS[from].includes(body.status)) {
      throw new AppError(409, 'INVALID_STATUS_TRANSITION', `A supplier cannot move from ${from} to ${body.status}.`, { allowed: TRANSITIONS[from] });
    }
    await tx.query('UPDATE supplier.suppliers SET status=$2, status_reason=$3, updated_at=now() WHERE id=$1', [id, body.status, body.reason]);
    await tx.query('INSERT INTO supplier.status_history (supplier_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)', [id, from, body.status, body.reason, req.user.id]);
    return from;
  });
  securityEvent('SUPPLIER_STATUS_CHANGED', { req, statusCode: 200, detail: { supplierId: id, from: result, to: body.status } });
  res.status(200).json({ supplier: supplierDto(await loadSupplier(id)) });
}

// ---------------------------------------------------------------- F8 archive (soft delete)
async function archiveSupplier(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const s = await loadSupplier(id);
  if (!s) throw notFound('Supplier');
  if (s.status === 'ARCHIVED') throw conflict('SUPPLIER_ARCHIVED', 'Supplier is already archived.');
  // Cross-service rule: ask the Order Service whether this supplier still has open orders.
  const r = await callService('order-service', 'GET', `/internal/suppliers/${id}/open-orders`, { actingUserId: req.user.id });
  if (r.status !== 200) throw new AppError(503, 'DEPENDENCY_ERROR', 'Could not check open orders for this supplier.');
  if (r.body.openCount > 0) {
    throw conflict('SUPPLIER_HAS_OPEN_ORDERS', `This supplier has ${r.body.openCount} open order(s). Deliver or cancel them before archiving.`);
  }
  await db.withTransaction(async (tx) => {
    await tx.query(`UPDATE supplier.suppliers SET status='ARCHIVED', status_reason='Archived by admin', updated_at=now() WHERE id=$1`, [id]);
    await tx.query(`UPDATE supplier.contracts SET status='TERMINATED', updated_at=now() WHERE supplier_id=$1 AND status='ACTIVE'`, [id]);
    await tx.query('INSERT INTO supplier.status_history (supplier_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)', [id, s.status, 'ARCHIVED', 'Archived by admin', req.user.id]);
  });
  securityEvent('SUPPLIER_ARCHIVED', { req, statusCode: 200, detail: { supplierId: id } });
  res.status(200).json({ message: 'Supplier archived.', supplierId: id });
}

// ---------------------------------------------------------------- contacts
async function addContact(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const body = validate(req.body).string('name', { required: true, min: 2, max: 100 }).string('jobTitle', { max: 80 }).email('email').phone('phone').done();
  if (!body.email && !body.phone) throw badRequest('Some fields are invalid.', [{ field: 'email', message: 'Give an e-mail or a phone number.' }]);
  const s = await loadSupplier(id);
  if (!s) throw notFound('Supplier');
  const { rows } = await db.query('INSERT INTO supplier.supplier_contacts (supplier_id, name, job_title, email, phone) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [id, body.name, body.jobTitle || null, body.email || null, body.phone || null]);
  res.status(201).json({ contact: { id: rows[0].id, name: rows[0].name, jobTitle: rows[0].job_title, email: rows[0].email, phone: rows[0].phone } });
}

async function deleteContact(req, res) {
  const supplierId = assertUuid(req.params.id, 'Supplier');
  const id = assertUuid(req.params.contactId, 'Contact');
  const { rowCount } = await db.query('DELETE FROM supplier.supplier_contacts WHERE id = $1 AND supplier_id = $2', [id, supplierId]);
  if (!rowCount) throw notFound('Contact');
  res.status(200).json({ message: 'Contact removed.' });
}

// ---------------------------------------------------------------- F5 contracts
async function convertForContract(value, currency, contractId, supplierId, userId) {
  if (currency === 'EGP') return { valueEgp: value, rateToEgp: 1, rateDate: today() };
  try {
    const r = await callService('evaluation-service', 'POST', '/internal/convert', {
      body: { amount: value, currency, sourceType: 'contract', sourceId: contractId, supplierId }, actingUserId: userId,
    });
    if (r.status === 200) return { valueEgp: r.body.amountEgp, rateToEgp: r.body.rateToEgp, rateDate: r.body.rateDate };
  } catch (_) { /* fall through: contract is still saved, conversion can be retried by editing it */ }
  return { valueEgp: null, rateToEgp: null, rateDate: null };
}

async function assertNoOverlap(supplierId, start, end, exceptId) {
  const { rows } = await db.query(
    `SELECT id, title, start_date, end_date FROM supplier.contracts
      WHERE supplier_id = $1 AND status = 'ACTIVE' AND ($4::uuid IS NULL OR id <> $4)
        AND start_date <= $3::date AND end_date >= $2::date`, [supplierId, start, end, exceptId || null]);
  if (rows.length) {
    throw conflict('CONTRACT_OVERLAP', `The dates overlap the active contract "${rows[0].title}" (${fmtDate(rows[0].start_date)} to ${fmtDate(rows[0].end_date)}).`);
  }
}

async function addContract(req, res) {
  const supplierId = assertUuid(req.params.id, 'Supplier');
  const body = validate(req.body)
    .string('title', { required: true, min: 3, max: 120 })
    .date('startDate', { required: true })
    .date('endDate', { required: true })
    .number('value', { required: true, min: 0.01, max: 1e12 })
    .currency('currency', { required: true })
    .done();
  if (body.endDate <= body.startDate) throw badRequest('Some fields are invalid.', [{ field: 'endDate', message: 'endDate must be after startDate.' }]);
  const s = await loadSupplier(supplierId);
  if (!s) throw notFound('Supplier');
  if (s.status === 'ARCHIVED') throw conflict('SUPPLIER_ARCHIVED', 'Cannot add a contract to an archived supplier.');
  await assertNoOverlap(supplierId, body.startDate, body.endDate);

  const { rows } = await db.query(
    `INSERT INTO supplier.contracts (supplier_id, title, start_date, end_date, value, currency, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [supplierId, body.title, body.startDate, body.endDate, body.value, body.currency, req.user.id]);
  const conv = await convertForContract(body.value, body.currency, rows[0].id, supplierId, req.user.id);
  const { rows: updated } = await db.query(
    'UPDATE supplier.contracts SET value_egp=$2, rate_to_egp=$3, rate_date=$4 WHERE id=$1 RETURNING *',
    [rows[0].id, conv.valueEgp, conv.rateToEgp, conv.rateDate]);
  res.status(201).json({ contract: contractDto(updated[0]), conversion: conv.valueEgp === null ? 'PENDING' : 'CONVERTED' });
}

async function updateContract(req, res) {
  const id = assertUuid(req.params.contractId, 'Contract');
  const body = validate(req.body)
    .string('title', { min: 3, max: 120 })
    .date('startDate').date('endDate')
    .number('value', { min: 0.01, max: 1e12 })
    .currency('currency')
    .oneOf('status', ['ACTIVE', 'TERMINATED'])
    .done();
  if (!Object.keys(body).length) throw badRequest('Nothing to update.');
  const { rows } = await db.query('SELECT * FROM supplier.contracts WHERE id = $1', [id]);
  const c = rows[0];
  if (!c) throw notFound('Contract');
  if (c.status === 'TERMINATED') throw conflict('CONTRACT_TERMINATED', 'A terminated contract cannot be changed.');
  const next = {
    title: body.title || c.title,
    startDate: body.startDate || fmtDate(c.start_date),
    endDate: body.endDate || fmtDate(c.end_date),
    value: body.value !== undefined ? body.value : Number(c.value),
    currency: body.currency || c.currency,
    status: body.status || c.status,
  };
  if (next.endDate <= next.startDate) throw badRequest('Some fields are invalid.', [{ field: 'endDate', message: 'endDate must be after startDate.' }]);
  if (next.status === 'ACTIVE') await assertNoOverlap(c.supplier_id, next.startDate, next.endDate, id);
  let conv = { valueEgp: c.value_egp, rateToEgp: c.rate_to_egp, rateDate: fmtDate(c.rate_date) };
  if (next.value !== Number(c.value) || next.currency !== c.currency || c.value_egp === null) {
    conv = await convertForContract(next.value, next.currency, id, c.supplier_id, req.user.id);
  }
  const { rows: u } = await db.query(
    `UPDATE supplier.contracts SET title=$2, start_date=$3, end_date=$4, value=$5, currency=$6, status=$7,
            value_egp=$8, rate_to_egp=$9, rate_date=$10, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, next.title, next.startDate, next.endDate, next.value, next.currency, next.status, conv.valueEgp, conv.rateToEgp, conv.rateDate]);
  res.status(200).json({ contract: contractDto(u[0]) });
}

// ---------------------------------------------------------------- F7 recommendations
async function recommendations(req, res) {
  const v = validate(req.query).number('categoryId', { required: true, integer: true, min: 1 }).number('limit', { integer: true, min: 1, max: 20 }).done();
  if (!(await categoryExists(v.categoryId))) throw notFound('Category');
  const { rows } = await db.query(
    `${SUPPLIER_SELECT}
      WHERE s.category_id = $1 AND s.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM supplier.contracts k WHERE k.supplier_id = s.id AND k.status = 'ACTIVE'
                     AND k.start_date <= CURRENT_DATE AND k.end_date >= CURRENT_DATE)
      ORDER BY s.avg_score DESC NULLS LAST, s.on_time_rate DESC NULLS LAST, s.rating_count DESC, s.name
      LIMIT $2`, [v.categoryId, v.limit || 5]);
  const ranked = rows.map((r, i) => {
    const d = supplierDto(r);
    let reason;
    if (d.performance.ratingCount === 0) reason = 'Eligible (active contract) but not rated yet.';
    else reason = `Average score ${d.performance.avgScore.toFixed(2)} from ${d.performance.ratingCount} rating(s)` +
      (d.performance.onTimeRate !== null ? `, ${d.performance.onTimeRate.toFixed(0)}% on time.` : '.');
    return { rank: i + 1, ...d, reason };
  });
  res.status(200).json({ categoryId: v.categoryId, recommendations: ranked });
}

// ================================================================ internal (service-to-service)

// GET /internal/suppliers/:id/eligibility?date=YYYY-MM-DD  (caller: order-service)
// Business rule: orders are allowed only for ACTIVE suppliers with a contract valid on the order date.
async function eligibility(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const date = validate(req.query).date('date').done().date || today();
  const s = await loadSupplier(id);
  if (!s || s.status === 'ARCHIVED') throw notFound('Supplier');
  const base = { supplier: { id: s.id, name: s.name, category: s.category_name, status: s.status } };
  if (s.status !== 'ACTIVE') {
    const why = s.status === 'SUSPENDED' ? 'is suspended' : 'is under review';
    return res.status(200).json({ ...base, eligible: false, code: `SUPPLIER_${s.status}`, reason: `Supplier ${why}${s.status_reason ? ': ' + s.status_reason.replace(/\.$/, '') : ''}.` });
  }
  const { rows } = await db.query(
    `SELECT * FROM supplier.contracts WHERE supplier_id = $1 AND status = 'ACTIVE'
       AND start_date <= $2::date AND end_date >= $2::date ORDER BY end_date DESC LIMIT 1`, [id, date]);
  if (!rows[0]) {
    return res.status(200).json({ ...base, eligible: false, code: 'NO_ACTIVE_CONTRACT', reason: `Supplier has no active contract on ${date}.` });
  }
  return res.status(200).json({ ...base, eligible: true, contract: contractDto(rows[0]) });
}

// PUT /internal/suppliers/:id/performance  (caller: evaluation-service)
// Stores the performance snapshot and applies the automatic review rule.
async function updatePerformance(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const body = validate(req.body)
    .number('avgScore', { min: 0, max: 5 })
    .number('ratingCount', { required: true, integer: true, min: 0 })
    .number('onTimeRate', { min: 0, max: 100 })
    .done();
  const outcome = await db.withTransaction(async (tx) => {
    const { rows } = await tx.query('SELECT status FROM supplier.suppliers WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Supplier');
    await tx.query('UPDATE supplier.suppliers SET avg_score=$2, rating_count=$3, on_time_rate=$4, score_updated_at=now() WHERE id=$1',
      [id, body.avgScore === undefined ? null : body.avgScore, body.ratingCount, body.onTimeRate === undefined ? null : body.onTimeRate]);
    const poor = body.ratingCount >= MIN_RATINGS_FOR_REVIEW() && body.avgScore !== undefined && body.avgScore < LOW_SCORE();
    if (poor && rows[0].status === 'ACTIVE') {
      const reason = `Automatic: average score ${body.avgScore.toFixed(2)} is below ${LOW_SCORE()} after ${body.ratingCount} ratings.`;
      await tx.query(`UPDATE supplier.suppliers SET status='UNDER_REVIEW', status_reason=$2, updated_at=now() WHERE id=$1`, [id, reason]);
      await tx.query(`INSERT INTO supplier.status_history (supplier_id, from_status, to_status, reason, changed_by) VALUES ($1,'ACTIVE','UNDER_REVIEW',$2,'evaluation-service')`, [id, reason]);
      return { statusChanged: true, newStatus: 'UNDER_REVIEW' };
    }
    return { statusChanged: false, newStatus: rows[0].status };
  });
  res.status(200).json(outcome);
}

module.exports = {
  listCategories, createCategory, createSupplier, searchSuppliers, getSupplier, updateSupplier, changeStatus,
  archiveSupplier, addContact, deleteContact, addContract, updateContract, recommendations, eligibility, updatePerformance,
};

// Order Service - owner: Ebraheem Mohamed Ebraheem (249043)
// Business capability: raise purchase orders against eligible suppliers, control spending, and track
// each order through approval and delivery.
//
// Functions (Phase 1 + the extra functions requested in the feedback):
//   F1 Create purchase order                 POST  /api/orders                 (admin, staff)
//        - asks the Supplier Service whether the supplier is eligible (ACTIVE + contract valid on the date)
//        - asks the Evaluation Service to convert foreign-currency amounts to EGP (ExchangeRate API)
//        - enforces the contract spending limit and the approval threshold
//   F2 List / filter orders                  GET   /api/orders                 (staff: own, admin: all)
//   F3 View one order with its history       GET   /api/orders/:id             (owner or admin)
//   F4 Update delivery status (workflow)     PATCH /api/orders/:id/status      (owner or admin)
//        - APPROVED -> DELIVERED computes on-time / days late; cancel only before delivery
//   F5 Approve / reject an order             PATCH /api/orders/:id/approval    (admin; never their own order)
//   F6 Spending summary (calculations)       GET   /api/orders/summary         (staff: own, admin: all)
//   F7 Retry a pending currency conversion   POST  /api/orders/:id/convert     (owner or admin)
//   Internal: order details for the Evaluation Service, open-order count for the Supplier Service.

const crypto = require('crypto');
const {
  db, validate, assertUuid, today, pagination, callService, securityEvent,
  AppError, notFound, badRequest, unprocessable,
} = require('../../shared');

const STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'DELIVERED', 'CANCELLED', 'REJECTED'];
const OPEN = ['PENDING_APPROVAL', 'APPROVED'];
const APPROVAL_THRESHOLD = () => Number(process.env.APPROVAL_THRESHOLD_EGP || 50000);
const MAX_BACKDATE_DAYS = 30;

const num = (v) => (v === null || v === undefined ? null : Number(v));
const orderDto = (o) => ({
  id: o.id, orderNumber: o.order_number, supplierId: o.supplier_id, supplierName: o.supplier_name, category: o.category,
  contractId: o.contract_id, createdBy: o.created_by, createdByName: o.created_by_name, description: o.description,
  quantity: o.quantity, unitPrice: num(o.unit_price), amount: num(o.amount), currency: o.currency,
  amountEgp: num(o.amount_egp), rateToEgp: num(o.rate_to_egp), rateDate: o.rate_date, conversionStatus: o.conversion_status,
  orderDate: o.order_date, expectedDate: o.expected_date, deliveredDate: o.delivered_date, onTime: o.on_time,
  daysLate: o.days_late, status: o.status, approvalNote: o.approval_note, approvedBy: o.approved_by,
  createdAt: o.created_at, updatedAt: o.updated_at,
});

const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const round2 = (n) => Math.round(n * 100) / 100;

// Loads an order and applies the ownership rule: Staff can only see their own orders.
// Another user's order answers 404 (not 403) so ids of other people's orders are not confirmed.
async function loadOwnedOrder(req, id, client = db, lock = false) {
  const { rows } = await client.query(`SELECT * FROM orders.purchase_orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  const o = rows[0];
  if (!o) throw notFound('Order');
  if (req.user.role !== 'admin' && o.created_by !== req.user.id) {
    securityEvent('ACCESS_DENIED_OWNERSHIP', { req, statusCode: 404, detail: { orderId: id } });
    throw notFound('Order');
  }
  return o;
}

async function addHistory(client, orderId, from, to, userId, note) {
  await client.query('INSERT INTO orders.order_status_history (order_id, from_status, to_status, note, changed_by) VALUES ($1,$2,$3,$4,$5)',
    [orderId, from, to, note || null, userId]);
}

// Every order value is recorded by the Evaluation Service (its EGP price ledger feeds the supplier
// performance/spending report). EGP needs no external rate; other currencies use the ExchangeRate API.
async function convert(amount, currency, orderId, supplierId, userId) {
  const egp = { status: 'NOT_NEEDED', amountEgp: amount, rateToEgp: 1, rateDate: today() };
  try {
    const r = await callService('evaluation-service', 'POST', '/internal/convert', {
      body: { amount, currency, sourceType: 'order', sourceId: orderId, supplierId }, actingUserId: userId,
    });
    if (r.status === 200) {
      if (currency === 'EGP') return egp;
      return { status: 'CONVERTED', amountEgp: r.body.amountEgp, rateToEgp: r.body.rateToEgp, rateDate: r.body.rateDate, stale: r.body.stale };
    }
  } catch (_) { /* rate service down: the order is still saved (proposal 6.4 threat 8) */ }
  if (currency === 'EGP') return egp; // EGP never needs a rate, so the order is unaffected
  return { status: 'PENDING', amountEgp: null, rateToEgp: null, rateDate: null };
}

// ---------------------------------------------------------------- F1 create
async function createOrder(req, res) {
  const body = validate(req.body)
    .uuid('supplierId', { required: true })
    .string('description', { required: true, min: 3, max: 300 })
    .number('quantity', { required: true, integer: true, min: 1, max: 100000 })
    .number('unitPrice', { required: true, min: 0.01, max: 1e9 })
    .currency('currency', { required: true })
    .date('orderDate', { notFuture: true })
    .date('expectedDate', { required: true })
    .forbid('status', 'createdBy', 'amountEgp', 'id')
    .done();
  const orderDate = body.orderDate || today();
  if (daysBetween(orderDate, today()) > MAX_BACKDATE_DAYS) throw badRequest('Some fields are invalid.', [{ field: 'orderDate', message: `orderDate cannot be more than ${MAX_BACKDATE_DAYS} days in the past.` }]);
  if (body.expectedDate < orderDate) throw badRequest('Some fields are invalid.', [{ field: 'expectedDate', message: 'expectedDate cannot be before orderDate.' }]);

  // 1) Supplier Service: is this supplier allowed to receive orders on this date?
  const elig = await callService('supplier-service', 'GET', `/internal/suppliers/${body.supplierId}/eligibility?date=${orderDate}`, { actingUserId: req.user.id });
  if (elig.status === 404) throw unprocessable('SUPPLIER_NOT_FOUND', 'The selected supplier does not exist.');
  if (elig.status !== 200) throw new AppError(503, 'DEPENDENCY_ERROR', 'Could not check the supplier. Please try again.');
  if (!elig.body.eligible) throw unprocessable(elig.body.code, elig.body.reason);
  const { supplier, contract } = elig.body;

  // 2) Evaluation Service: convert to EGP.
  const id = crypto.randomUUID();
  const amount = round2(body.quantity * body.unitPrice);
  const conv = await convert(amount, body.currency, id, supplier.id, req.user.id);

  // 3) Contract spending limit (needs EGP values on both sides).
  let note = null;
  if (conv.amountEgp !== null && contract.valueEgp !== null) {
    const { rows } = await db.query(
      `SELECT coalesce(sum(amount_egp), 0)::numeric AS used FROM orders.purchase_orders
        WHERE contract_id = $1 AND status NOT IN ('CANCELLED', 'REJECTED')`, [contract.id]);
    const used = Number(rows[0].used);
    const remaining = round2(contract.valueEgp - used);
    if (conv.amountEgp > remaining) {
      throw unprocessable('CONTRACT_LIMIT_EXCEEDED',
        `This order (${conv.amountEgp.toFixed(2)} EGP) exceeds the remaining contract value (${remaining.toFixed(2)} EGP).`,
        { contractId: contract.id, contractValueEgp: contract.valueEgp, usedEgp: used, remainingEgp: remaining });
    }
  } else {
    note = 'EGP value unknown (exchange rate unavailable) - admin approval required.';
  }

  // 4) Approval rule: large or unconverted orders wait for an Admin.
  const needsApproval = conv.amountEgp === null || conv.amountEgp > APPROVAL_THRESHOLD();
  if (needsApproval && !note) note = `Above the approval threshold of ${APPROVAL_THRESHOLD()} EGP.`;
  const status = needsApproval ? 'PENDING_APPROVAL' : 'APPROVED';

  const order = await db.withTransaction(async (tx) => {
    const { rows: seq } = await tx.query(`SELECT nextval('orders.order_number_seq') AS n`);
    const { rows } = await tx.query(
      `INSERT INTO orders.purchase_orders
        (id, order_number, supplier_id, supplier_name, category, contract_id, created_by, created_by_name, description, quantity,
         unit_price, amount, currency, amount_egp, rate_to_egp, rate_date, conversion_status, order_date, expected_date, status, approval_note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
      [id, `PO-${seq[0].n}`, supplier.id, supplier.name, supplier.category, contract.id, req.user.id, req.user.name || null,
        body.description, body.quantity, body.unitPrice, amount, body.currency, conv.amountEgp, conv.rateToEgp, conv.rateDate,
        conv.status, orderDate, body.expectedDate, status, needsApproval ? note : null]);
    await addHistory(tx, id, null, status, req.user.id, needsApproval ? note : 'Within approval threshold - auto-approved.');
    return rows[0];
  });
  res.status(201).json({ order: orderDto(order), rateStale: Boolean(conv.stale) });
}

// ---------------------------------------------------------------- F2 list / filter
async function listOrders(req, res) {
  const v = validate(req.query)
    .uuid('supplierId').oneOf('status', STATUSES).date('from').date('to').string('search', { max: 60 })
    .oneOf('mine', ['true', 'false'])
    .done();
  const { limit, offset, page } = pagination(req.query);
  const ownerOnly = req.user.role !== 'admin' || v.mine === 'true';
  const params = [ownerOnly ? req.user.id : null, v.supplierId || null, v.status || null, v.from || null, v.to || null, v.search || ''];
  const where = `WHERE ($1::uuid IS NULL OR created_by = $1)
      AND ($2::uuid IS NULL OR supplier_id = $2)
      AND ($3::text IS NULL OR status = $3)
      AND ($4::date IS NULL OR order_date >= $4)
      AND ($5::date IS NULL OR order_date <= $5)
      AND ($6 = '' OR order_number ILIKE '%' || $6 || '%' OR description ILIKE '%' || $6 || '%' OR supplier_name ILIKE '%' || $6 || '%')`;
  const total = await db.query(`SELECT count(*)::int AS n FROM orders.purchase_orders ${where}`, params);
  const { rows } = await db.query(`SELECT * FROM orders.purchase_orders ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.status(200).json({ orders: rows.map(orderDto), page, limit, total: total.rows[0].n });
}

// ---------------------------------------------------------------- F3 details
async function getOrder(req, res) {
  const id = assertUuid(req.params.id, 'Order');
  const o = await loadOwnedOrder(req, id);
  const { rows } = await db.query('SELECT from_status, to_status, note, changed_by, changed_at FROM orders.order_status_history WHERE order_id = $1 ORDER BY id', [id]);
  res.status(200).json({ order: orderDto(o), history: rows.map((h) => ({ from: h.from_status, to: h.to_status, note: h.note, changedBy: h.changed_by, changedAt: h.changed_at })) });
}

// ---------------------------------------------------------------- F4 delivery status workflow
async function updateStatus(req, res) {
  const id = assertUuid(req.params.id, 'Order');
  const body = validate(req.body)
    .oneOf('status', ['DELIVERED', 'CANCELLED'], { required: true })
    .date('deliveredDate', { notFuture: true })
    .string('note', { max: 300 })
    .done();
  const updated = await db.withTransaction(async (tx) => {
    const o = await loadOwnedOrder(req, id, tx, true);
    if (body.status === 'DELIVERED') {
      if (o.status !== 'APPROVED') throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Only APPROVED orders can be delivered (this order is ${o.status}).`);
      const delivered = body.deliveredDate || today();
      if (delivered < o.order_date) throw badRequest('Some fields are invalid.', [{ field: 'deliveredDate', message: 'deliveredDate cannot be before the order date.' }]);
      const late = Math.max(0, daysBetween(o.expected_date, delivered));
      const { rows } = await tx.query(
        `UPDATE orders.purchase_orders SET status='DELIVERED', delivered_date=$2, on_time=$3, days_late=$4, updated_at=now() WHERE id=$1 RETURNING *`,
        [id, delivered, late === 0, late]);
      await addHistory(tx, id, o.status, 'DELIVERED', req.user.id, body.note || (late ? `Delivered ${late} day(s) late.` : 'Delivered on time.'));
      return rows[0];
    }
    // CANCELLED
    if (!OPEN.includes(o.status)) throw new AppError(409, 'INVALID_STATUS_TRANSITION', `A ${o.status} order cannot be cancelled.`);
    const { rows } = await tx.query(`UPDATE orders.purchase_orders SET status='CANCELLED', updated_at=now() WHERE id=$1 RETURNING *`, [id]);
    await addHistory(tx, id, o.status, 'CANCELLED', req.user.id, body.note || 'Cancelled.');
    return rows[0];
  });
  res.status(200).json({ order: orderDto(updated) });
}

// ---------------------------------------------------------------- F5 approval (admin)
async function decideApproval(req, res) {
  const id = assertUuid(req.params.id, 'Order');
  const body = validate(req.body).oneOf('decision', ['APPROVE', 'REJECT'], { required: true }).string('note', { max: 300 }).done();
  if (body.decision === 'REJECT' && !body.note) throw badRequest('Some fields are invalid.', [{ field: 'note', message: 'A reason is required when rejecting.' }]);
  const updated = await db.withTransaction(async (tx) => {
    const o = await loadOwnedOrder(req, id, tx, true);
    if (o.status !== 'PENDING_APPROVAL') throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Only orders waiting for approval can be decided (this order is ${o.status}).`);
    // Segregation of duties: the person who raised an order cannot approve it.
    if (o.created_by === req.user.id) {
      securityEvent('ACCESS_DENIED_SELF_APPROVAL', { req, statusCode: 403, detail: { orderId: id } });
      throw new AppError(403, 'SELF_APPROVAL_NOT_ALLOWED', 'You cannot approve or reject an order you created.');
    }
    const to = body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const { rows } = await tx.query(
      `UPDATE orders.purchase_orders SET status=$2, approved_by=$3, approval_note=$4, updated_at=now() WHERE id=$1 RETURNING *`,
      [id, to, req.user.id, body.note || null]);
    await addHistory(tx, id, o.status, to, req.user.id, body.note);
    return rows[0];
  });
  res.status(200).json({ order: orderDto(updated) });
}

// ---------------------------------------------------------------- F6 spending summary
async function summary(req, res) {
  const v = validate(req.query).date('from').date('to').done();
  const owner = req.user.role === 'admin' ? null : req.user.id;
  const params = [owner, v.from || null, v.to || null];
  const where = `WHERE ($1::uuid IS NULL OR created_by = $1) AND ($2::date IS NULL OR order_date >= $2) AND ($3::date IS NULL OR order_date <= $3)`;
  const [bySupplier, byMonth, totals] = await Promise.all([
    db.query(`SELECT supplier_id, supplier_name, count(*)::int AS orders,
                     coalesce(sum(amount_egp) FILTER (WHERE status NOT IN ('CANCELLED','REJECTED')), 0) AS spend_egp,
                     count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered,
                     round(100.0 * count(*) FILTER (WHERE on_time) / NULLIF(count(*) FILTER (WHERE status = 'DELIVERED'), 0), 1) AS on_time_rate,
                     round(avg(days_late) FILTER (WHERE status = 'DELIVERED'), 1) AS avg_days_late
                FROM orders.purchase_orders ${where} GROUP BY 1, 2 ORDER BY spend_egp DESC`, params),
    db.query(`SELECT to_char(order_date, 'YYYY-MM') AS month, count(*)::int AS orders,
                     coalesce(sum(amount_egp) FILTER (WHERE status NOT IN ('CANCELLED','REJECTED')), 0) AS spend_egp
                FROM orders.purchase_orders ${where} GROUP BY 1 ORDER BY 1`, params),
    db.query(`SELECT count(*)::int AS orders,
                     coalesce(sum(amount_egp) FILTER (WHERE status NOT IN ('CANCELLED','REJECTED')), 0) AS spend_egp,
                     count(*) FILTER (WHERE status = 'PENDING_APPROVAL')::int AS pending_approval,
                     count(*) FILTER (WHERE conversion_status = 'PENDING')::int AS pending_conversion,
                     count(*) FILTER (WHERE status = 'DELIVERED')::int AS delivered
                FROM orders.purchase_orders ${where}`, params),
  ]);
  const t = totals.rows[0];
  res.status(200).json({
    scope: owner ? 'own' : 'all',
    totals: { orders: t.orders, spendEgp: Number(t.spend_egp), pendingApproval: t.pending_approval, pendingConversion: t.pending_conversion, delivered: t.delivered },
    bySupplier: bySupplier.rows.map((r) => ({ supplierId: r.supplier_id, supplierName: r.supplier_name, orders: r.orders, spendEgp: Number(r.spend_egp), delivered: r.delivered, onTimeRate: num(r.on_time_rate), avgDaysLate: num(r.avg_days_late) })),
    byMonth: byMonth.rows.map((r) => ({ month: r.month, orders: r.orders, spendEgp: Number(r.spend_egp) })),
  });
}

// ---------------------------------------------------------------- F7 retry conversion
async function retryConversion(req, res) {
  const id = assertUuid(req.params.id, 'Order');
  const o = await loadOwnedOrder(req, id);
  if (o.conversion_status !== 'PENDING') throw new AppError(409, 'ALREADY_CONVERTED', 'This order already has an EGP value.');
  const conv = await convert(Number(o.amount), o.currency, o.id, o.supplier_id, req.user.id);
  if (conv.status === 'PENDING') throw new AppError(502, 'RATE_UNAVAILABLE', 'The exchange-rate service is still unavailable. Try again later.');
  const { rows } = await db.query(
    `UPDATE orders.purchase_orders SET amount_egp=$2, rate_to_egp=$3, rate_date=$4, conversion_status=$5, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, conv.amountEgp, conv.rateToEgp, conv.rateDate, conv.status]);
  res.status(200).json({ order: orderDto(rows[0]) });
}

// ================================================================ internal
// GET /internal/orders/:id (caller: evaluation-service) - no ownership filter; the caller applies its own rules.
async function internalGetOrder(req, res) {
  const id = assertUuid(req.params.id, 'Order');
  const { rows } = await db.query('SELECT * FROM orders.purchase_orders WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Order');
  res.status(200).json({ order: orderDto(rows[0]) });
}

// GET /internal/suppliers/:id/open-orders (caller: supplier-service)
async function openOrdersForSupplier(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM orders.purchase_orders WHERE supplier_id = $1 AND status = ANY($2)`, [id, OPEN]);
  res.status(200).json({ supplierId: id, openCount: rows[0].n });
}

module.exports = { createOrder, listOrders, getOrder, updateStatus, decideApproval, summary, retryConversion, internalGetOrder, openOrdersForSupplier };

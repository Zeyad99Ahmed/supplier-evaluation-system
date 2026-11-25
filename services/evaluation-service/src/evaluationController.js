// Evaluation Service - owner: Karim Hisham (249581)
// Business capability: rate suppliers after delivery, calculate their performance, and convert prices
// to EGP so suppliers can be compared fairly.
//
//   F1 Submit a rating for a delivered order     POST   /api/evaluations                 (staff, own delivered orders, once)
//        - asks the Order Service for the order (must be DELIVERED and created by this user)
//        - weighted score: 0.4 x quality + 0.3 x price + 0.3 x delivery
//        - recalculates the supplier's average and sends it to the Supplier Service
//   F2 Supplier performance report               GET    /api/performance/suppliers/:id   (admin, staff)
//        - averages per criterion, on-time rate, EGP spend, 90-day trend
//   F3 Compare suppliers                         GET    /api/performance/compare         (admin, staff)
//   F4 Rating history (search / filter)          GET    /api/evaluations                 (admin, staff)
//   F5 Edit / delete own rating (7-day window)   PUT / DELETE /api/evaluations/:id        (author only)
//   F6 Currency rates and conversion (external)  GET    /api/rates/:currency, /api/rates/convert
//                                                POST   /internal/convert (Order and Supplier services)

const {
  db, validate, assertUuid, pagination, callService, securityEvent, logger,
  AppError, notFound, badRequest, conflict,
} = require('../../shared');
const rates = require('./exchangeRates');

const EDIT_WINDOW_DAYS = () => Number(process.env.EDIT_WINDOW_DAYS || 7);
const WEIGHTS = { quality: 0.4, price: 0.3, delivery: 0.3 };
const overallScore = (q, p, d) => Math.round((q * WEIGHTS.quality + p * WEIGHTS.price + d * WEIGHTS.delivery) * 100) / 100;
const n = (v) => (v === null || v === undefined ? null : Number(v));

const evalDto = (e) => ({
  id: e.id, orderId: e.order_id, orderNumber: e.order_number, supplierId: e.supplier_id, supplierName: e.supplier_name,
  ratedBy: e.rated_by, ratedByName: e.rated_by_name, quality: e.quality, price: e.price, delivery: e.delivery,
  overall: n(e.overall), comment: e.comment, onTime: e.on_time, amountEgp: n(e.amount_egp),
  createdAt: e.created_at, updatedAt: e.updated_at,
});

function scoreFields(body, required) {
  return validate(body)
    .number('quality', { required, integer: true, min: 1, max: 5 })
    .number('price', { required, integer: true, min: 1, max: 5 })
    .number('delivery', { required, integer: true, min: 1, max: 5 })
    .string('comment', { max: 500 });
}

// Recalculate a supplier's aggregate and push it to the Supplier Service (which may put the supplier
// UNDER_REVIEW). If the Supplier Service is down the rating is still saved; Admin can re-sync later.
async function pushPerformance(supplierId, actingUserId) {
  const { rows } = await db.query(
    `SELECT round(avg(overall), 2) AS avg, count(*)::int AS cnt,
            round(100.0 * count(*) FILTER (WHERE on_time) / NULLIF(count(*) FILTER (WHERE on_time IS NOT NULL), 0), 2) AS on_time
       FROM evaluation.evaluations WHERE supplier_id = $1`, [supplierId]);
  const agg = { avgScore: n(rows[0].avg), ratingCount: rows[0].cnt, onTimeRate: n(rows[0].on_time) };
  try {
    const r = await callService('supplier-service', 'PUT', `/internal/suppliers/${supplierId}/performance`, { body: agg, actingUserId });
    return { ...agg, synced: r.status === 200, supplierStatusChanged: Boolean(r.body && r.body.statusChanged), supplierStatus: r.body && r.body.newStatus };
  } catch (e) {
    logger.warn('PERFORMANCE_SYNC_DEFERRED', { supplierId, reason: e.message });
    return { ...agg, synced: false };
  }
}

async function loadOwnEvaluation(req, id) {
  const { rows } = await db.query('SELECT * FROM evaluation.evaluations WHERE id = $1', [id]);
  const e = rows[0];
  if (!e) throw notFound('Rating');
  if (e.rated_by !== req.user.id) {
    securityEvent('ACCESS_DENIED_OWNERSHIP', { req, statusCode: 404, detail: { evaluationId: id } });
    throw notFound('Rating'); // only the author may change a rating; others get 404
  }
  return e;
}

function assertWithinWindow(e) {
  const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86400000;
  if (ageDays > EDIT_WINDOW_DAYS()) throw new AppError(409, 'EDIT_WINDOW_CLOSED', `Ratings can only be changed within ${EDIT_WINDOW_DAYS()} days.`);
}

// ---------------------------------------------------------------- F1 submit rating
async function submitRating(req, res) {
  const body = scoreFields(req.body, true).uuid('orderId', { required: true }).forbid('overall', 'ratedBy', 'supplierId').done();

  // Evaluation -> Order: is the order real, delivered, and raised by this user?
  const r = await callService('order-service', 'GET', `/internal/orders/${body.orderId}`, { actingUserId: req.user.id });
  if (r.status === 404) throw notFound('Order');
  if (r.status !== 200) throw new AppError(503, 'DEPENDENCY_ERROR', 'Could not load the order. Please try again.');
  const order = r.body.order;
  if (order.createdBy !== req.user.id) {
    securityEvent('ACCESS_DENIED_OWNERSHIP', { req, statusCode: 404, detail: { orderId: body.orderId, action: 'rate' } });
    throw notFound('Order');
  }
  if (order.status !== 'DELIVERED') throw conflict('ORDER_NOT_DELIVERED', `Only delivered orders can be rated (this order is ${order.status}).`);

  const overall = overallScore(body.quality, body.price, body.delivery);
  let row;
  try {
    const { rows } = await db.query(
      `INSERT INTO evaluation.evaluations (order_id, order_number, supplier_id, supplier_name, rated_by, rated_by_name, quality, price, delivery, overall, comment, on_time, amount_egp)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [order.id, order.orderNumber, order.supplierId, order.supplierName, req.user.id, req.user.name || null,
        body.quality, body.price, body.delivery, overall, body.comment || null, order.onTime, order.amountEgp]);
    row = rows[0];
  } catch (e) {
    if (e.code === '23505') throw conflict('ALREADY_RATED', 'This order has already been rated.'); // UNIQUE(order_id)
    throw e;
  }
  const performance = await pushPerformance(order.supplierId, req.user.id);
  res.status(201).json({ evaluation: evalDto(row), supplierPerformance: performance });
}

// ---------------------------------------------------------------- F4 history
async function listEvaluations(req, res) {
  const v = validate(req.query).uuid('supplierId').oneOf('mine', ['true', 'false']).number('minOverall', { min: 1, max: 5 }).date('from').date('to').done();
  const { limit, offset, page } = pagination(req.query);
  const params = [v.supplierId || null, v.mine === 'true' ? req.user.id : null, v.minOverall || null, v.from || null, v.to || null];
  const where = `WHERE ($1::uuid IS NULL OR supplier_id = $1) AND ($2::uuid IS NULL OR rated_by = $2)
      AND ($3::numeric IS NULL OR overall >= $3) AND ($4::date IS NULL OR created_at >= $4) AND ($5::date IS NULL OR created_at < $5::date + 1)`;
  const total = await db.query(`SELECT count(*)::int AS n FROM evaluation.evaluations ${where}`, params);
  const { rows } = await db.query(`SELECT * FROM evaluation.evaluations ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
  res.status(200).json({ evaluations: rows.map(evalDto), page, limit, total: total.rows[0].n, editWindowDays: EDIT_WINDOW_DAYS() });
}

// GET /api/evaluations/orders/:orderId - does this order already have a rating? (used by the rating form)
async function getByOrder(req, res) {
  const orderId = assertUuid(req.params.orderId, 'Order');
  const { rows } = await db.query('SELECT * FROM evaluation.evaluations WHERE order_id = $1', [orderId]);
  if (!rows[0]) throw notFound('Rating');
  res.status(200).json({ evaluation: evalDto(rows[0]) });
}

// ---------------------------------------------------------------- F5 edit / delete own rating
async function updateRating(req, res) {
  const id = assertUuid(req.params.id, 'Rating');
  const body = scoreFields(req.body, true).forbid('orderId', 'supplierId', 'ratedBy', 'overall').done();
  const e = await loadOwnEvaluation(req, id);
  assertWithinWindow(e);
  const overall = overallScore(body.quality, body.price, body.delivery);
  const { rows } = await db.query(
    `UPDATE evaluation.evaluations SET quality=$2, price=$3, delivery=$4, overall=$5, comment=$6, updated_at=now() WHERE id=$1 RETURNING *`,
    [id, body.quality, body.price, body.delivery, overall, body.comment || null]);
  const performance = await pushPerformance(e.supplier_id, req.user.id);
  res.status(200).json({ evaluation: evalDto(rows[0]), supplierPerformance: performance });
}

async function deleteRating(req, res) {
  const id = assertUuid(req.params.id, 'Rating');
  const e = await loadOwnEvaluation(req, id);
  assertWithinWindow(e);
  await db.query('DELETE FROM evaluation.evaluations WHERE id = $1 AND rated_by = $2', [id, req.user.id]);
  const performance = await pushPerformance(e.supplier_id, req.user.id);
  res.status(200).json({ message: 'Rating deleted.', supplierPerformance: performance });
}

// ---------------------------------------------------------------- F2 performance report
async function supplierReport(supplierId) {
  const [agg, trend, spend, dist] = await Promise.all([
    db.query(`SELECT max(supplier_name) AS name, count(*)::int AS cnt, round(avg(overall),2) AS overall, round(avg(quality),2) AS quality,
                     round(avg(price),2) AS price, round(avg(delivery),2) AS delivery,
                     round(100.0 * count(*) FILTER (WHERE on_time) / NULLIF(count(*) FILTER (WHERE on_time IS NOT NULL),0),1) AS on_time,
                     min(overall) AS worst, max(overall) AS best, max(created_at) AS last_rated
                FROM evaluation.evaluations WHERE supplier_id = $1`, [supplierId]),
    db.query(`SELECT round(avg(overall) FILTER (WHERE created_at > now() - interval '90 days'),2) AS recent,
                     round(avg(overall) FILTER (WHERE created_at <= now() - interval '90 days'),2) AS earlier
                FROM evaluation.evaluations WHERE supplier_id = $1`, [supplierId]),
    db.query(`SELECT count(*)::int AS orders, coalesce(sum(amount_egp),0) AS total_egp, round(avg(amount_egp),2) AS avg_egp,
                     array_agg(DISTINCT currency) AS currencies
                FROM evaluation.price_conversions WHERE supplier_id = $1 AND source_type = 'order'`, [supplierId]),
    db.query(`SELECT round(overall)::int AS stars, count(*)::int AS cnt FROM evaluation.evaluations WHERE supplier_id = $1 GROUP BY 1 ORDER BY 1`, [supplierId]),
  ]);
  const a = agg.rows[0]; const t = trend.rows[0]; const s = spend.rows[0];
  let direction = 'not enough data';
  if (t.recent !== null && t.earlier !== null) {
    const diff = Number(t.recent) - Number(t.earlier);
    direction = diff > 0.2 ? 'improving' : diff < -0.2 ? 'declining' : 'stable';
  }
  return {
    supplierId, supplierName: a.name, ratingCount: a.cnt,
    averages: { overall: n(a.overall), quality: n(a.quality), price: n(a.price), delivery: n(a.delivery) },
    onTimeRate: n(a.on_time), best: n(a.best), worst: n(a.worst), lastRatedAt: a.last_rated,
    trend: { last90Days: n(t.recent), before: n(t.earlier), direction },
    distribution: dist.rows.map((d) => ({ stars: d.stars, count: d.cnt })),
    spending: { convertedOrders: s.orders, totalEgp: Number(s.total_egp), averageOrderEgp: n(s.avg_egp), currencies: (s.currencies || []).filter(Boolean) },
    weights: WEIGHTS,
  };
}

async function performance(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  res.status(200).json({ report: await supplierReport(id) });
}

// ---------------------------------------------------------------- F3 compare
async function compare(req, res) {
  const raw = typeof req.query.supplierIds === 'string' ? req.query.supplierIds.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const ids = [...new Set(raw)];
  if (ids.length < 2 || ids.length > 5) throw badRequest('Some fields are invalid.', [{ field: 'supplierIds', message: 'Give between 2 and 5 supplier ids, comma separated.' }]);
  ids.forEach((id) => validate({ id }).uuid('id', { required: true }).done());
  const reports = await Promise.all(ids.map(supplierReport));
  const best = (key) => {
    const rated = reports.filter((r) => r.averages[key] !== null);
    if (!rated.length) return null;
    return rated.reduce((x, y) => (y.averages[key] > x.averages[key] ? y : x)).supplierId;
  };
  const ranking = [...reports].sort((x, y) => (y.averages.overall ?? -1) - (x.averages.overall ?? -1)).map((r, i) => ({ rank: i + 1, supplierId: r.supplierId, overall: r.averages.overall }));
  res.status(200).json({
    suppliers: reports,
    bestBy: { overall: best('overall'), quality: best('quality'), price: best('price'), delivery: best('delivery') },
    ranking,
  });
}

// POST /api/performance/suppliers/:id/sync (admin) - re-send the aggregate if an earlier push failed
async function resync(req, res) {
  const id = assertUuid(req.params.id, 'Supplier');
  const p = await pushPerformance(id, req.user.id);
  if (!p.synced) throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'The Supplier Service is not reachable right now.');
  res.status(200).json({ supplierPerformance: p });
}

// ---------------------------------------------------------------- F6 rates (external API)
async function getRate(req, res) {
  const { currency } = validate({ currency: req.params.currency }).currency('currency', { required: true }).done();
  const r = await rates.rateToEgp(currency);
  res.status(200).json({ currency, rateToEgp: r.rate, rateDate: r.providerDate, stale: r.stale, provider: rates.providerName() });
}

async function convertQuery(req, res) {
  const v = validate(req.query).number('amount', { required: true, min: 0.01, max: 1e12 }).currency('currency', { required: true }).done();
  const out = await rates.convertAndRecord({ amount: v.amount, currency: v.currency, sourceType: 'lookup', requestedBy: req.user.id });
  res.status(200).json(out);
}

// POST /internal/convert  (callers: order-service, supplier-service)
async function internalConvert(req, res) {
  const v = validate(req.body)
    .number('amount', { required: true, min: 0.01, max: 1e12 })
    .currency('currency', { required: true })
    .oneOf('sourceType', ['order', 'contract'], { required: true })
    .uuid('sourceId').uuid('supplierId')
    .done();
  const out = await rates.convertAndRecord({ ...v, requestedBy: req.caller });
  res.status(200).json(out);
}

module.exports = {
  submitRating, listEvaluations, getByOrder, updateRating, deleteRating, performance, compare, resync, getRate, convertQuery, internalConvert,
};

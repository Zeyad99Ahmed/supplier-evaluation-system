// External integration: ExchangeRate-API (https://www.exchangerate-api.com) - owner: Karim.
// Workflow it supports: every foreign-currency order and contract is converted to EGP, so prices from
// different suppliers can be compared, contract limits enforced and spending totalled in one currency.
//
//  - With EXCHANGE_API_KEY (from Secrets Manager / .env, never in code) the keyed v6 endpoint is used;
//    without a key the provider's open endpoint is used (same data, daily updates).
//  - Rates are cached in evaluation.rate_cache for RATE_CACHE_HOURS (default 6h): fewer external
//    calls (cost/quota) and faster responses.
//  - Every response is validated (result=success, rate is a positive number) and the call times out.
//  - If the provider fails, the last cached rate (up to 7 days old) is used and marked stale=true;
//    with no usable rate the caller gets 502 RATE_UNAVAILABLE and can retry later.
//  - The API key is never logged: only the provider host appears in logs.

const { db, AppError, securityEvent, logger, CURRENCIES } = require('../../shared');

const CACHE_HOURS = () => Number(process.env.RATE_CACHE_HOURS || 6);
const STALE_DAYS = 7;

function providerUrl() {
  if (process.env.EXCHANGE_API_BASE_URL) return process.env.EXCHANGE_API_BASE_URL.replace(/\/$/, '') + '/latest/EGP'; // tests / outage simulation
  if (process.env.EXCHANGE_API_KEY) return `https://v6.exchangerate-api.com/v6/${encodeURIComponent(process.env.EXCHANGE_API_KEY)}/latest/EGP`;
  return 'https://open.er-api.com/v6/latest/EGP';
}
const providerName = () => (process.env.EXCHANGE_API_KEY ? 'exchangerate-api.com (v6 key)' : 'exchangerate-api.com (open access)');

async function fetchFromProvider() {
  const url = providerUrl();
  const host = new URL(url).host;
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(Number(process.env.EXCHANGE_API_TIMEOUT_MS || 5000)) });
  } catch (e) {
    throw new Error(`network error contacting ${host}: ${e.name}`);
  }
  if (!res.ok) throw new Error(`${host} answered HTTP ${res.status}`);
  const data = await res.json().catch(() => null);
  // Validate the provider response before trusting it.
  const rates = data && (data.rates || data.conversion_rates);
  if (!data || data.result !== 'success' || !rates || typeof rates !== 'object') throw new Error(`${host} returned an invalid response`);
  for (const c of CURRENCIES) {
    if (!(typeof rates[c] === 'number' && rates[c] > 0 && Number.isFinite(rates[c]))) throw new Error(`${host} returned no valid rate for ${c}`);
  }
  const providerDate = data.time_last_update_unix ? new Date(data.time_last_update_unix * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  logger.info('EXTERNAL_API_CALL', { provider: host, ms: Date.now() - started, ok: true });
  return { rates, providerDate };
}

// Returns { rates (1 EGP = x CUR), providerDate, stale, source }
async function getRates() {
  const { rows } = await db.query(`SELECT rates, provider_date, fetched_at FROM evaluation.rate_cache WHERE base = 'EGP'`);
  const cached = rows[0];
  const ageHours = cached ? (Date.now() - new Date(cached.fetched_at).getTime()) / 3600000 : Infinity;
  if (cached && ageHours < CACHE_HOURS()) return { rates: cached.rates, providerDate: cached.provider_date, stale: false, source: 'cache' };
  try {
    const fresh = await fetchFromProvider();
    await db.query(
      `INSERT INTO evaluation.rate_cache (base, rates, provider_date, fetched_at) VALUES ('EGP', $1, $2, now())
       ON CONFLICT (base) DO UPDATE SET rates = EXCLUDED.rates, provider_date = EXCLUDED.provider_date, fetched_at = now()`,
      [JSON.stringify(fresh.rates), fresh.providerDate]);
    return { rates: fresh.rates, providerDate: fresh.providerDate, stale: false, source: 'provider' };
  } catch (e) {
    securityEvent('EXTERNAL_API_FAILURE', { statusCode: 502, detail: { provider: 'exchangerate-api', reason: e.message } });
    if (cached && ageHours < STALE_DAYS * 24) return { rates: cached.rates, providerDate: cached.provider_date, stale: true, source: 'stale-cache' };
    throw new AppError(502, 'RATE_UNAVAILABLE', 'Exchange rates are unavailable right now. Please try again later.');
  }
}

// How many EGP one unit of `currency` is worth.
async function rateToEgp(currency) {
  if (currency === 'EGP') return { rate: 1, providerDate: new Date().toISOString().slice(0, 10), stale: false };
  const r = await getRates();
  const perEgp = Number(r.rates[currency]);
  if (!(perEgp > 0)) throw new AppError(502, 'RATE_UNAVAILABLE', `No exchange rate available for ${currency}.`);
  return { rate: Math.round((1 / perEgp) * 1e8) / 1e8, providerDate: r.providerDate, stale: r.stale };
}

// Converts and records the conversion (rate + date are stored with the value - proposal section 1.5).
async function convertAndRecord({ amount, currency, sourceType, sourceId, supplierId, requestedBy }) {
  const r = await rateToEgp(currency);
  const amountEgp = Math.round(amount * r.rate * 100) / 100;
  if (sourceType !== 'lookup') {
    await db.query(
      `INSERT INTO evaluation.price_conversions (source_type, source_id, supplier_id, currency, original_amount, rate_to_egp, amount_egp, rate_date, provider, stale, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [sourceType, sourceId || null, supplierId || null, currency, amount, r.rate, amountEgp, r.providerDate, providerName(), r.stale, requestedBy || null]);
  }
  return { amount, currency, amountEgp, rateToEgp: r.rate, rateDate: r.providerDate, stale: r.stale, provider: providerName() };
}

module.exports = { getRates, rateToEgp, convertAndRecord, providerName };

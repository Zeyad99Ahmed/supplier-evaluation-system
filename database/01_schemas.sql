-- Supplier Directory & Evaluation System - database schema (PostgreSQL 14+ / Neon)
-- Run by the migration owner (scripts/db-setup.js), never by the services themselves.
-- Each service owns ONE schema. Services never read another service's schema; they call its API.
--
--   auth        -> Auth Service (shared, lead: Zeyad)        users, sessions
--   supplier    -> Supplier Service (Zeyad)                  categories, suppliers, contacts, contracts, status history
--   orders      -> Order Service (Ebraheem)                  purchase_orders, order_status_history
--   evaluation  -> Evaluation Service (Karim)                evaluations, price_conversions, rate_cache
--   audit       -> all services (INSERT only), auth reads    activity_log
--
-- Cross-service references (e.g. orders.purchase_orders.supplier_id) are plain UUID columns, not foreign
-- keys, because the referenced row lives in another service's schema. The owning service checks them
-- through an internal API call instead (e.g. Order asks Supplier whether a supplier is eligible).

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS supplier;
CREATE SCHEMA IF NOT EXISTS orders;
CREATE SCHEMA IF NOT EXISTS evaluation;
CREATE SCHEMA IF NOT EXISTS audit;

-- ---------------------------------------------------------------- auth
CREATE TABLE IF NOT EXISTS auth.users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  password_hash    text NOT NULL,                       -- scrypt$N$salt$hash (never returned by the API)
  full_name        text NOT NULL CHECK (char_length(full_name) BETWEEN 2 AND 100),
  role             text NOT NULL CHECK (role IN ('admin', 'staff')),
  is_active        boolean NOT NULL DEFAULT true,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq ON auth.users (lower(email));

CREATE TABLE IF NOT EXISTS auth.sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON auth.sessions (user_id);

-- ---------------------------------------------------------------- audit
CREATE TABLE IF NOT EXISTS audit.activity_log (
  id           bigserial PRIMARY KEY,
  event_type   text NOT NULL,
  service      text NOT NULL,
  user_id      uuid,
  path         text,
  status_code  integer,
  ip           text,
  detail       jsonb,          -- never passwords, tokens or comments
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_created_idx ON audit.activity_log (created_at);
CREATE INDEX IF NOT EXISTS activity_type_idx ON audit.activity_log (event_type, created_at);

-- ---------------------------------------------------------------- supplier
CREATE TABLE IF NOT EXISTS supplier.categories (
  id          serial PRIMARY KEY,
  name        text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 60),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier.suppliers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  category_id      integer NOT NULL REFERENCES supplier.categories(id),
  email            text NOT NULL,
  phone            text,
  address          text,
  country          text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'UNDER_REVIEW', 'SUSPENDED', 'ARCHIVED')),
  status_reason    text,
  -- performance snapshot pushed by the Evaluation Service after every rating change
  avg_score        numeric(3,2),
  rating_count     integer NOT NULL DEFAULT 0,
  on_time_rate     numeric(5,2),
  score_updated_at timestamptz,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_uq ON supplier.suppliers (lower(name));
CREATE INDEX IF NOT EXISTS suppliers_category_idx ON supplier.suppliers (category_id, status);

CREATE TABLE IF NOT EXISTS supplier.supplier_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES supplier.suppliers(id) ON DELETE CASCADE,
  name         text NOT NULL,
  job_title    text,
  email        text,
  phone        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier.contracts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id  uuid NOT NULL REFERENCES supplier.suppliers(id),
  title        text NOT NULL,
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  value        numeric(14,2) NOT NULL CHECK (value > 0),
  currency     char(3) NOT NULL,
  value_egp    numeric(16,2),                     -- converted via Evaluation Service (ExchangeRate API)
  rate_to_egp  numeric(18,8),
  rate_date    date,
  status       text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TERMINATED')),
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);
CREATE INDEX IF NOT EXISTS contracts_supplier_idx ON supplier.contracts (supplier_id, status);

CREATE TABLE IF NOT EXISTS supplier.status_history (
  id           bigserial PRIMARY KEY,
  supplier_id  uuid NOT NULL REFERENCES supplier.suppliers(id),
  from_status  text,
  to_status    text NOT NULL,
  reason       text,
  changed_by   text NOT NULL,                      -- user id or 'evaluation-service'
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- orders
CREATE TABLE IF NOT EXISTS orders.purchase_orders (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number       text NOT NULL UNIQUE,
  supplier_id        uuid NOT NULL,                -- lives in supplier schema (checked via API)
  supplier_name      text NOT NULL,                -- snapshot at order time
  category           text,
  contract_id        uuid,
  created_by         uuid NOT NULL,
  created_by_name    text,
  description        text NOT NULL CHECK (char_length(description) BETWEEN 3 AND 300),
  quantity           integer NOT NULL CHECK (quantity > 0 AND quantity <= 100000),
  unit_price         numeric(14,2) NOT NULL CHECK (unit_price > 0),
  amount             numeric(16,2) NOT NULL CHECK (amount > 0),
  currency           char(3) NOT NULL,
  amount_egp         numeric(18,2),
  rate_to_egp        numeric(18,8),
  rate_date          date,
  conversion_status  text NOT NULL CHECK (conversion_status IN ('NOT_NEEDED', 'CONVERTED', 'PENDING')),
  order_date         date NOT NULL,
  expected_date      date NOT NULL,
  delivered_date     date,
  on_time            boolean,
  days_late          integer,
  status             text NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'DELIVERED', 'CANCELLED', 'REJECTED')),
  approval_note      text,
  approved_by        uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (expected_date >= order_date)
);
CREATE INDEX IF NOT EXISTS po_supplier_idx ON orders.purchase_orders (supplier_id, status);
CREATE INDEX IF NOT EXISTS po_owner_idx ON orders.purchase_orders (created_by, created_at);
CREATE INDEX IF NOT EXISTS po_contract_idx ON orders.purchase_orders (contract_id);

CREATE TABLE IF NOT EXISTS orders.order_status_history (
  id           bigserial PRIMARY KEY,
  order_id     uuid NOT NULL REFERENCES orders.purchase_orders(id),
  from_status  text,
  to_status    text NOT NULL,
  note         text,
  changed_by   uuid NOT NULL,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS orders.order_number_seq START 1001;

-- ---------------------------------------------------------------- evaluation
CREATE TABLE IF NOT EXISTS evaluation.evaluations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL UNIQUE,            -- one rating per order
  order_number   text,
  supplier_id    uuid NOT NULL,
  supplier_name  text,
  rated_by       uuid NOT NULL,
  rated_by_name  text,
  quality        smallint NOT NULL CHECK (quality BETWEEN 1 AND 5),
  price          smallint NOT NULL CHECK (price BETWEEN 1 AND 5),
  delivery       smallint NOT NULL CHECK (delivery BETWEEN 1 AND 5),
  overall        numeric(3,2) NOT NULL,           -- 0.4*quality + 0.3*price + 0.3*delivery
  comment        text CHECK (comment IS NULL OR char_length(comment) <= 500),
  on_time        boolean,
  amount_egp     numeric(18,2),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eval_supplier_idx ON evaluation.evaluations (supplier_id, created_at);
CREATE INDEX IF NOT EXISTS eval_rater_idx ON evaluation.evaluations (rated_by);

CREATE TABLE IF NOT EXISTS evaluation.price_conversions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type      text NOT NULL CHECK (source_type IN ('order', 'contract', 'lookup')),
  source_id        uuid,
  supplier_id      uuid,
  currency         char(3) NOT NULL,
  original_amount  numeric(16,2) NOT NULL,
  rate_to_egp      numeric(18,8) NOT NULL,
  amount_egp       numeric(18,2) NOT NULL,
  rate_date        date NOT NULL,
  provider         text NOT NULL,
  stale            boolean NOT NULL DEFAULT false,
  requested_by     text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conv_supplier_idx ON evaluation.price_conversions (supplier_id, source_type);

CREATE TABLE IF NOT EXISTS evaluation.rate_cache (
  base           char(3) PRIMARY KEY,
  rates          jsonb NOT NULL,
  provider_date  date NOT NULL,
  fetched_at     timestamptz NOT NULL DEFAULT now()
);

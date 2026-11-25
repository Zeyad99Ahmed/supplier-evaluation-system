-- One database role per service (Phase 1 feedback: "give each service its own database role").
-- The roles are created with their passwords by scripts/db-setup.js (passwords come from the
-- git-ignored env file / Secrets Manager, never from this file). This file only grants privileges.
--
-- Least privilege: each role gets USAGE on its own schema and only the table operations its code
-- performs. No role can create/alter/drop tables (DDL stays with the migration owner), and no role can
-- read another service's schema. audit.activity_log is INSERT-only for services (they cannot erase
-- their own traces); only auth_svc can SELECT it for the Admin monitoring page.

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA auth, supplier, orders, evaluation, audit FROM PUBLIC;

-- ---------------- auth_svc (Auth Service)
GRANT USAGE ON SCHEMA auth, audit TO auth_svc;
GRANT SELECT, INSERT, UPDATE ON auth.users TO auth_svc;              -- no DELETE: accounts are disabled, not deleted
GRANT SELECT, INSERT, UPDATE ON auth.sessions TO auth_svc;           -- logout = UPDATE revoked_at
GRANT SELECT, INSERT ON audit.activity_log TO auth_svc;
GRANT USAGE ON SEQUENCE audit.activity_log_id_seq TO auth_svc;

-- ---------------- supplier_svc (Supplier Service - Zeyad)
GRANT USAGE ON SCHEMA supplier, audit TO supplier_svc;
GRANT SELECT, INSERT ON supplier.categories TO supplier_svc;
GRANT SELECT, INSERT, UPDATE ON supplier.suppliers TO supplier_svc;  -- no DELETE: suppliers are archived (soft delete)
GRANT SELECT, INSERT, DELETE ON supplier.supplier_contacts TO supplier_svc;
GRANT SELECT, INSERT, UPDATE ON supplier.contracts TO supplier_svc;
GRANT SELECT, INSERT ON supplier.status_history TO supplier_svc;
GRANT USAGE ON SEQUENCE supplier.categories_id_seq, supplier.status_history_id_seq TO supplier_svc;
GRANT INSERT ON audit.activity_log TO supplier_svc;
GRANT USAGE ON SEQUENCE audit.activity_log_id_seq TO supplier_svc;

-- ---------------- order_svc (Order Service - Ebraheem)
GRANT USAGE ON SCHEMA orders, audit TO order_svc;
GRANT SELECT, INSERT, UPDATE ON orders.purchase_orders TO order_svc; -- no DELETE: orders are cancelled, never erased
GRANT SELECT, INSERT ON orders.order_status_history TO order_svc;
GRANT USAGE ON SEQUENCE orders.order_number_seq, orders.order_status_history_id_seq TO order_svc;
GRANT INSERT ON audit.activity_log TO order_svc;
GRANT USAGE ON SEQUENCE audit.activity_log_id_seq TO order_svc;

-- ---------------- evaluation_svc (Evaluation Service - Karim)
GRANT USAGE ON SCHEMA evaluation, audit TO evaluation_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON evaluation.evaluations TO evaluation_svc; -- authors may delete their rating
GRANT SELECT, INSERT ON evaluation.price_conversions TO evaluation_svc;
GRANT SELECT, INSERT, UPDATE ON evaluation.rate_cache TO evaluation_svc;
GRANT INSERT ON audit.activity_log TO evaluation_svc;
GRANT USAGE ON SEQUENCE audit.activity_log_id_seq TO evaluation_svc;

-- Each role finds its own tables first.
ALTER ROLE auth_svc SET search_path = auth, audit;
ALTER ROLE supplier_svc SET search_path = supplier, audit;
ALTER ROLE order_svc SET search_path = orders, audit;
ALTER ROLE evaluation_svc SET search_path = evaluation, audit;

-- Reference data only. Users are created by scripts/db-setup.js (admin from env settings),
-- demo suppliers/orders by scripts/seed-demo.js through the real APIs.
INSERT INTO supplier.categories (name) VALUES
  ('Electronics'), ('Raw Materials'), ('Packaging'), ('Office Supplies'), ('Logistics'), ('IT Services')
ON CONFLICT (name) DO NOTHING;

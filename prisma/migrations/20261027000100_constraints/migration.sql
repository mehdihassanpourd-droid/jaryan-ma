-- Database-level invariants the application must never be able to violate, even through a bug
-- or a manual SQL session. Business rules per fulfilment type are enforced by the domain layer;
-- these checks are the safety net.

ALTER TABLE "products"
  ADD CONSTRAINT "products_price_nonneg" CHECK ("priceToman" IS NULL OR "priceToman" >= 0),
  ADD CONSTRAINT "products_inventory_nonneg" CHECK ("inventory" IS NULL OR "inventory" >= 0),
  ADD CONSTRAINT "products_lead_time_positive" CHECK ("leadTimeDays" IS NULL OR "leadTimeDays" > 0),
  -- made-to-order products have no stock; unique pieces hold 0 or 1
  ADD CONSTRAINT "products_made_to_order_no_stock" CHECK ("fulfillment" <> 'made_to_order' OR "inventory" IS NULL),
  ADD CONSTRAINT "products_unique_stock" CHECK ("fulfillment" <> 'unique' OR "inventory" IN (0, 1)),
  ADD CONSTRAINT "products_version_positive" CHECK ("version" >= 1);

ALTER TABLE "product_variants"
  ADD CONSTRAINT "variants_price_nonneg" CHECK ("priceToman" IS NULL OR "priceToman" >= 0),
  ADD CONSTRAINT "variants_inventory_nonneg" CHECK ("inventory" IS NULL OR "inventory" >= 0);

ALTER TABLE "admin_users"
  ADD CONSTRAINT "admin_users_email_lowercase" CHECK ("email" = lower("email"));

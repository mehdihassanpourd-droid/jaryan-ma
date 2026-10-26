-- Database-level safety nets for the customer, order, money and support tables. The domain layer validates
-- first; these make sure a bug or a manual SQL session still cannot store impossible data.

-- Money: whole Toman within the application's exact range (10^15, see src/domain/money.ts).
ALTER TABLE "products"
  ADD CONSTRAINT "products_price_max" CHECK ("priceToman" IS NULL OR "priceToman" <= 1000000000000000);
ALTER TABLE "product_variants"
  ADD CONSTRAINT "variants_price_max" CHECK ("priceToman" IS NULL OR "priceToman" <= 1000000000000000);
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_total_range" CHECK ("totalToman" >= 0 AND "totalToman" <= 1000000000000000);
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_price_range" CHECK ("unitPriceToman" >= 0 AND "unitPriceToman" <= 1000000000000000),
  ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" >= 1 AND "quantity" <= 1000);

-- Customers: canonical Iranian mobile numbers only (or the tombstone written by anonymisation).
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_phone_format" CHECK ("phone" ~ '^\+989[0-9]{9}$' OR "phone" LIKE 'deleted:%');
ALTER TABLE "customer_otps"
  ADD CONSTRAINT "customer_otps_attempts_nonneg" CHECK ("attempts" >= 0);

-- Addresses: Iranian postal code is 10 digits; at most one default address per customer.
ALTER TABLE "addresses"
  ADD CONSTRAINT "addresses_postal_code_format" CHECK ("postalCode" ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "addresses_phone_format" CHECK ("recipientPhone" ~ '^\+989[0-9]{9}$');
CREATE UNIQUE INDEX "addresses_one_default_per_customer" ON "addresses" ("customerId") WHERE "isDefault";

-- Support: a resolved/closed ticket carries its timestamps.
ALTER TABLE "support_tickets"
  ADD CONSTRAINT "tickets_closed_has_time" CHECK ("status" <> 'closed' OR "closedAt" IS NOT NULL),
  ADD CONSTRAINT "tickets_resolved_has_time" CHECK ("status" NOT IN ('resolved', 'closed') OR "resolvedAt" IS NOT NULL);
ALTER TABLE "support_messages"
  ADD CONSTRAINT "messages_staff_has_admin" CHECK ("author" <> 'staff' OR "adminId" IS NOT NULL);

-- Maintenance
ALTER TABLE "backup_records"
  ADD CONSTRAINT "backup_size_nonneg" CHECK ("sizeBytes" >= 0),
  -- a restore test result requires the time it was run
  ADD CONSTRAINT "backup_restore_test_consistent" CHECK (("restoreTestOk" IS NULL) = ("restoreTestedAt" IS NULL));

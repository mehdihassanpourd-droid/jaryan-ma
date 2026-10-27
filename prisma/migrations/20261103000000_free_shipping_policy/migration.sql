-- Shop-wide free shipping policy (additive). The owner switches it on, sets the minimum items subtotal (whole Toman) and
-- chooses which delivery methods qualify, all from the admin screen.
--  * Data written by the previous per-method thresholds is carried over: if any carried method had a threshold, the policy is
--    enabled with the LOWEST of them and exactly those methods. (Nothing is deleted: the old column stays, unused.)

-- AlterTable
ALTER TABLE "shipping_settings" ADD COLUMN     "freeShippingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "freeShippingMethods" "ShippingMethod"[],
ADD COLUMN     "freeShippingThresholdToman" BIGINT;

UPDATE "shipping_settings" SET
  "freeShippingEnabled" = true,
  "freeShippingThresholdToman" = (SELECT MIN("freeThresholdToman") FROM "shipping_method_configs" WHERE "freeThresholdToman" IS NOT NULL AND "method" <> 'pickup'),
  "freeShippingMethods" = (SELECT array_agg("method" ORDER BY "method") FROM "shipping_method_configs" WHERE "freeThresholdToman" IS NOT NULL AND "method" <> 'pickup')
WHERE EXISTS (SELECT 1 FROM "shipping_method_configs" WHERE "freeThresholdToman" IS NOT NULL AND "method" <> 'pickup');

ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_free_shipping" CHECK ("freeShippingThresholdToman" IS NULL OR "freeShippingThresholdToman" >= 0);

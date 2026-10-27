-- Shipping and delivery (additive; existing products, orders and customers are kept as they are).
--  * orders.subtotalToman = the lines' sum. Existing orders had no shipping fee, so subtotal = total and fee = 0.
--  * orders.deliveryMethod stays NULL for existing orders (no delivery method was ever chosen for them).
--  * shipping_method_configs gets the four methods, all DISABLED: nothing is offered until the owner configures rates.
--  * shipping_settings: one row with technical defaults the owner can change (default item weight 500 g, no packaging).

-- CreateEnum
CREATE TYPE "ShippingMethod" AS ENUM ('post', 'tipax', 'local_courier', 'pickup');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "weightGrams" INTEGER;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryDetails" JSONB,
ADD COLUMN     "deliveryMethod" "ShippingMethod",
ADD COLUMN     "shippingFeeToman" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "subtotalToman" BIGINT NOT NULL DEFAULT 0;

UPDATE "orders" SET "subtotalToman" = "totalToman";

-- CreateTable
CREATE TABLE "shipping_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "defaultItemWeightGrams" INTEGER NOT NULL DEFAULT 500,
    "packagingWeightGrams" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_method_configs" (
    "method" "ShippingMethod" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "freeThresholdToman" BIGINT,
    "etaMinDays" INTEGER,
    "etaMaxDays" INTEGER,
    "note" TEXT,

    CONSTRAINT "shipping_method_configs_pkey" PRIMARY KEY ("method")
);

-- CreateTable
CREATE TABLE "shipping_rates" (
    "id" TEXT NOT NULL,
    "method" "ShippingMethod" NOT NULL,
    "position" INTEGER NOT NULL,
    "provinces" TEXT[],
    "cities" TEXT[],
    "minWeightGrams" INTEGER NOT NULL DEFAULT 0,
    "maxWeightGrams" INTEGER,
    "priceToman" BIGINT NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_shipments" (
    "orderId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "carrierName" TEXT,
    "trackingCode" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_shipments_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE INDEX "shipping_rates_method_position_idx" ON "shipping_rates"("method", "position");

-- AddForeignKey
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_method_fkey" FOREIGN KEY ("method") REFERENCES "shipping_method_configs"("method") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_shipments" ADD CONSTRAINT "order_shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Sanity rules the application also enforces
ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_single_row" CHECK ("id" = 1);
ALTER TABLE "shipping_settings" ADD CONSTRAINT "shipping_settings_ranges" CHECK ("defaultItemWeightGrams" BETWEEN 1 AND 100000 AND "packagingWeightGrams" BETWEEN 0 AND 100000);
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_weight_band" CHECK ("minWeightGrams" >= 0 AND ("maxWeightGrams" IS NULL OR "maxWeightGrams" >= "minWeightGrams"));
ALTER TABLE "shipping_rates" ADD CONSTRAINT "shipping_rates_price" CHECK ("priceToman" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_fee_nonnegative" CHECK ("shippingFeeToman" >= 0 AND "subtotalToman" >= 0);

-- Seed: the four methods (disabled) and the settings row
INSERT INTO "shipping_method_configs" ("method", "enabled") VALUES ('post', false), ('tipax', false), ('local_courier', false), ('pickup', false);
INSERT INTO "shipping_settings" ("id") VALUES (1);

-- Order management and inventory safety (additive; existing products and orders are kept as they are).
--  * order_items.reservedQuantity: units held out of the product's/variant's inventory for that line. Existing lines get 0:
--    they were placed before reservations existed and never held stock, so cancelling them must not "give back" stock.
--  * order_status_events: the history of every order, written with each change. Existing orders get one "migrated" event.
--  * OrderStatus gets 'rejected' (refused by staff before confirmation). The value is not used inside this migration.

-- CreateEnum
CREATE TYPE "OrderActor" AS ENUM ('customer', 'staff', 'system');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'rejected';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "reservedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_status_events" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "actorType" "OrderActor" NOT NULL,
    "actorLabel" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_status_events_orderId_createdAt_idx" ON "order_status_events"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_status_placedAt_idx" ON "orders"("status", "placedAt" DESC);

-- AddForeignKey
ALTER TABLE "order_status_events" ADD CONSTRAINT "order_status_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A line can never hold more than it ordered, nor a negative amount (a safety net below the application's atomic updates).
ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_reserved_range" CHECK ("reservedQuantity" >= 0 AND "reservedQuantity" <= "quantity");

-- One history entry per existing order, so no order starts with an empty history.
INSERT INTO "order_status_events" ("id", "orderId", "fromStatus", "toStatus", "actorType", "actorLabel", "reason", "createdAt")
SELECT gen_random_uuid()::text, "id", NULL, "status", 'system', NULL, NULL, "placedAt" FROM "orders";

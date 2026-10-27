-- Idempotency key for checkout: a retry of the same attempt must find the order it already created.
-- Additive and nullable (existing orders have none; NULLs never collide in a unique index).
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_customerId_requestId_key" ON "orders"("customerId", "requestId");


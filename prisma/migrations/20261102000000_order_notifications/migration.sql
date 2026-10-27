-- Shipment tracking SMS outbox (additive; nothing existing changes). No notification is created for existing orders.

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'skipped');

-- CreateTable
CREATE TABLE "order_notifications" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL,
    "lastError" TEXT,
    "skipReason" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "order_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_notifications_dedupeKey_key" ON "order_notifications"("dedupeKey");
CREATE INDEX "order_notifications_orderId_idx" ON "order_notifications"("orderId");
CREATE INDEX "order_notifications_status_idx" ON "order_notifications"("status");

-- AddForeignKey
ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_notifications" ADD CONSTRAINT "order_notifications_attempts" CHECK ("attempts" >= 0);

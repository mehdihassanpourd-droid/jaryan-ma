-- Customers, orders (read model), support and maintenance, plus BIGINT money.
--
-- NOTE ON DROPS: the draft "User", "VendorMember", "Address", "Order" and "OrderItem" tables from the first
-- migration were never used by any code and never held data (nothing is deployed), so they are replaced here.
-- Do not copy this pattern for tables that hold data: migrate it instead.
--
-- Money columns become BIGINT. Widening INTEGER -> BIGINT is lossless and keeps existing CHECK constraints valid.



-- DropForeignKey
ALTER TABLE "VendorMember" DROP CONSTRAINT "VendorMember_vendorId_fkey";

-- DropForeignKey
ALTER TABLE "VendorMember" DROP CONSTRAINT "VendorMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "Address" DROP CONSTRAINT "Address_userId_fkey";

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_orderId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_productId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItem" DROP CONSTRAINT "OrderItem_vendorId_fkey";

-- DropTable
DROP TABLE "User";

-- DropTable
DROP TABLE "VendorMember";

-- DropTable
DROP TABLE "Address";

-- DropTable
DROP TABLE "Order";

-- DropTable
DROP TABLE "OrderItem";

-- DropEnum
DROP TYPE "UserRole";

-- DropEnum (re-created below with lower-case values; its only user, the old "Order" table, is gone)
DROP TYPE "OrderStatus";

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('active', 'pending_deletion', 'anonymized', 'suspended');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('sign_in');

-- CreateEnum
CREATE TYPE "DataRequestType" AS ENUM ('export', 'deletion');

-- CreateEnum
CREATE TYPE "DataRequestStatus" AS ENUM ('requested', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('order', 'product', 'shipping', 'returns', 'account', 'website', 'other');

-- CreateEnum
CREATE TYPE "MessageAuthor" AS ENUM ('customer', 'staff', 'system');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('minor', 'major', 'critical');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('investigating', 'identified', 'monitoring', 'resolved');

-- CreateEnum
CREATE TYPE "IncidentSource" AS ENUM ('manual', 'health_check', 'deployment', 'security', 'backup');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('database', 'media');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled');

-- AlterEnum
ALTER TYPE "AdminRole" ADD VALUE 'support';

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "priceToman" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "product_variants" ALTER COLUMN "priceToman" SET DATA TYPE BIGINT;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'active',
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerifiedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "deletionRequestedAt" TIMESTAMP(3),
    "deletionScheduledAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_otps" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'sign_in',
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "providerMessageId" TEXT,

    CONSTRAINT "customer_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientPhone" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "plaque" TEXT,
    "unit" TEXT,
    "postalCode" TEXT NOT NULL,
    "notes" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("customerId","productId")
);

-- CreateTable
CREATE TABLE "customer_data_requests" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "DataRequestType" NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'requested',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "customer_data_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "totalToman" BIGINT NOT NULL,
    "shipping" JSONB NOT NULL,
    "customerNote" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "titleSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "variantSnapshot" JSONB,
    "imageKeySnapshot" TEXT,
    "unitPriceToman" BIGINT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT,
    "subject" TEXT NOT NULL,
    "category" "TicketCategory" NOT NULL DEFAULT 'other',
    "status" "TicketStatus" NOT NULL DEFAULT 'open',
    "priority" "TicketPriority" NOT NULL DEFAULT 'normal',
    "assignedToId" TEXT,
    "duplicateKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCustomerMessageAt" TIMESTAMP(3),
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "author" "MessageAuthor" NOT NULL,
    "adminId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_notes" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "faq_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_items" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "IncidentSeverity" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'investigating',
    "source" "IncidentSource" NOT NULL DEFAULT 'manual',
    "summary" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_updates" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author" TEXT NOT NULL,
    "status" "IncidentStatus",
    "message" TEXT NOT NULL,

    CONSTRAINT "incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "kind" "BackupKind" NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "location" TEXT NOT NULL,
    "sha256" TEXT,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "recordedBy" TEXT NOT NULL,
    "restoreTestedAt" TIMESTAMP(3),
    "restoreTestOk" BOOLEAN,
    "restoreTestNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_reports" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "release" TEXT,
    "name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "url" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "error_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_log" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "maintenance_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE INDEX "customers_status_deletionScheduledAt_idx" ON "customers"("status", "deletionScheduledAt");

-- CreateIndex
CREATE INDEX "customer_otps_phone_createdAt_idx" ON "customer_otps"("phone", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "customer_otps_ip_createdAt_idx" ON "customer_otps"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "customer_otps_createdAt_idx" ON "customer_otps"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_tokenHash_key" ON "customer_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "customer_sessions_customerId_idx" ON "customer_sessions"("customerId");

-- CreateIndex
CREATE INDEX "customer_sessions_expiresAt_idx" ON "customer_sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "addresses_customerId_idx" ON "addresses"("customerId");

-- CreateIndex
CREATE INDEX "favorites_customerId_createdAt_idx" ON "favorites"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "customer_data_requests_customerId_type_requestedAt_idx" ON "customer_data_requests"("customerId", "type", "requestedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_customerId_placedAt_idx" ON "orders"("customerId", "placedAt" DESC);

-- CreateIndex
CREATE INDEX "order_items_orderId_idx" ON "order_items"("orderId");

-- CreateIndex
CREATE INDEX "order_items_vendorId_idx" ON "order_items"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_lastMessageAt_idx" ON "support_tickets"("status", "priority", "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_customerId_createdAt_idx" ON "support_tickets"("customerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_assignedToId_status_idx" ON "support_tickets"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "support_tickets_customerId_duplicateKey_idx" ON "support_tickets"("customerId", "duplicateKey");

-- CreateIndex
CREATE INDEX "support_messages_ticketId_createdAt_idx" ON "support_messages"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "support_notes_ticketId_createdAt_idx" ON "support_notes"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "faq_categories_slug_key" ON "faq_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "faq_items_slug_key" ON "faq_items"("slug");

-- CreateIndex
CREATE INDEX "faq_items_categoryId_position_idx" ON "faq_items"("categoryId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_number_key" ON "incidents"("number");

-- CreateIndex
CREATE INDEX "incidents_status_startedAt_idx" ON "incidents"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "incident_updates_incidentId_at_idx" ON "incident_updates"("incidentId", "at");

-- CreateIndex
CREATE INDEX "backup_records_kind_takenAt_idx" ON "backup_records"("kind", "takenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "error_reports_fingerprint_key" ON "error_reports"("fingerprint");

-- CreateIndex
CREATE INDEX "error_reports_lastSeenAt_idx" ON "error_reports"("lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "error_reports_resolved_lastSeenAt_idx" ON "error_reports"("resolved", "lastSeenAt" DESC);

-- CreateIndex
CREATE INDEX "maintenance_log_at_idx" ON "maintenance_log"("at" DESC);

-- CreateIndex
CREATE INDEX "maintenance_log_action_at_idx" ON "maintenance_log"("action", "at" DESC);

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_data_requests" ADD CONSTRAINT "customer_data_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faq_items" ADD CONSTRAINT "faq_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "faq_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_updates" ADD CONSTRAINT "incident_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

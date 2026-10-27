import { z } from "zod";
import { tomanFromDb } from "../../src/domain/money";
import type { AdminOrderJson } from "../../src/domain/customer/order-admin";
import { ORDER_STATUSES } from "../../src/domain/customer/order-status";
import type { ShippingSnapshot } from "../../src/domain/customer/schema";
import type { Prisma } from "../../src/generated/prisma/client";
import type { CarrierKey } from "../../src/domain/shipping/methods";
import { deliveryOf } from "../customers/prisma-account-store";
import type { Db } from "../db/client";

export const adminOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(ORDER_STATUSES).optional(),
});
export type AdminOrderListQuery = z.output<typeof adminOrderListQuery>;

const INCLUDE = { items: { orderBy: [{ titleSnapshot: "asc" }, { skuSnapshot: "asc" }] }, statusHistory: { orderBy: { seq: "asc" } }, shipment: true, notifications: { orderBy: { createdAt: "desc" } }, customer: { select: { phone: true, firstName: true, lastName: true, status: true } } } satisfies Prisma.OrderInclude;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;

/** The order as it goes over JSON (a Date serialises to the same ISO string). */
function toView(o: Row, enabled: boolean): AdminOrderJson {
  const anonymised = o.customer.status === "anonymized";
  const name = [o.customer.firstName, o.customer.lastName].filter(Boolean).join(" ");
  return {
    number: o.number,
    status: o.status,
    totalToman: tomanFromDb(o.totalToman),
    subtotalToman: tomanFromDb(o.subtotalToman),
    shippingFeeToman: tomanFromDb(o.shippingFeeToman),
    delivery: { ...deliveryOf(o), weightGrams: ((o.deliveryDetails ?? {}) as { weightGrams?: number }).weightGrams ?? null },
    shipment: o.shipment
      ? { carrier: o.shipment.carrier as CarrierKey, carrierName: o.shipment.carrierName, trackingCode: o.shipment.trackingCode, updatedBy: o.shipment.updatedBy, updatedAt: o.shipment.updatedAt.toISOString() }
      : null,
    notifications: {
      enabled,
      items: o.notifications.map((n) => ({ id: n.id, status: n.status, attempts: n.attempts, lastError: n.lastError, skipReason: n.skipReason, createdAt: n.createdAt.toISOString(), sentAt: n.sentAt?.toISOString() ?? null, lastAttemptAt: n.lastAttemptAt?.toISOString() ?? null, message: n.message })),
    },
    placedAt: o.placedAt.toISOString(),
    customerNote: o.customerNote,
    shipping: o.shipping as unknown as ShippingSnapshot,
    customer: { phone: anonymised ? null : o.customer.phone, name: anonymised || !name ? null : name },
    items: o.items.map((i) => ({
      title: i.titleSnapshot,
      sku: i.skuSnapshot,
      variant: (i.variantSnapshot as Record<string, string> | null) ?? null,
      imageKey: i.imageKeySnapshot,
      unitPriceToman: tomanFromDb(i.unitPriceToman),
      quantity: i.quantity,
      reservedQuantity: i.reservedQuantity,
    })),
    history: o.statusHistory.map((e) => ({ from: e.fromStatus, to: e.toStatus, actor: e.actorType, actorLabel: e.actorLabel, reason: e.reason, at: e.createdAt.toISOString() })),
  };
}

/** Staff view of every order. The list shows open orders first (pending on top: PostgreSQL sorts enums in declaration order), newest first within a status. Changing an order is `OrderLifecycleService`. */
export class OrderAdminService {
  constructor(
    private readonly db: Db,
    /** Whether the tracking SMS is switched on (the screen shows retry only then). */
    private readonly notificationsEnabled: boolean = false,
  ) {}

  async list(query: AdminOrderListQuery): Promise<{ items: AdminOrderJson[]; total: number }> {
    const where: Prisma.OrderWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await this.db.$transaction([
      this.db.order.findMany({ where, orderBy: [{ status: "asc" }, { placedAt: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: INCLUDE }),
      this.db.order.count({ where }),
    ]);
    return { items: rows.map((r) => toView(r, this.notificationsEnabled)), total };
  }

  async get(number: number): Promise<AdminOrderJson | null> {
    const row = await this.db.order.findUnique({ where: { number }, include: INCLUDE });
    return row ? toView(row, this.notificationsEnabled) : null;
  }
}

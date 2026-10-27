import { z } from "zod";
import { tomanFromDb } from "../../src/domain/money";
import { ORDER_STATUSES, type AdminOrderJson } from "../../src/domain/customer/order-admin";
import type { ShippingSnapshot } from "../../src/domain/customer/schema";
import type { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";

export const adminOrderListQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(ORDER_STATUSES).optional(),
});
export type AdminOrderListQuery = z.output<typeof adminOrderListQuery>;

const INCLUDE = { items: { orderBy: [{ titleSnapshot: "asc" }, { skuSnapshot: "asc" }] }, customer: { select: { phone: true, firstName: true, lastName: true, status: true } } } satisfies Prisma.OrderInclude;
type Row = Prisma.OrderGetPayload<{ include: typeof INCLUDE }>;

/** The order as it goes over JSON (a Date serialises to the same ISO string). */
function toView(o: Row): AdminOrderJson {
  const anonymised = o.customer.status === "anonymized";
  const name = [o.customer.firstName, o.customer.lastName].filter(Boolean).join(" ");
  return {
    number: o.number,
    status: o.status,
    totalToman: tomanFromDb(o.totalToman),
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
    })),
  };
}

/** Read-only view of every order for staff. Orders are never changed here: confirming or cancelling is a later step. */
export class OrderAdminService {
  constructor(private readonly db: Db) {}

  async list(query: AdminOrderListQuery): Promise<{ items: AdminOrderJson[]; total: number }> {
    const where: Prisma.OrderWhereInput = query.status ? { status: query.status } : {};
    const [rows, total] = await this.db.$transaction([
      this.db.order.findMany({ where, orderBy: { placedAt: "desc" }, skip: (query.page - 1) * query.pageSize, take: query.pageSize, include: INCLUDE }),
      this.db.order.count({ where }),
    ]);
    return { items: rows.map(toView), total };
  }

  async get(number: number): Promise<AdminOrderJson | null> {
    const row = await this.db.order.findUnique({ where: { number }, include: INCLUDE });
    return row ? toView(row) : null;
  }
}

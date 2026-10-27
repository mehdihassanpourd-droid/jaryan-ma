import { z } from "zod";
import { canTransition, ORDER_REASON_MAX, ORDER_STATUSES, releasesStock, type OrderActorType, type OrderStatusValue } from "../../src/domain/customer/order-status";
import { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import { releaseStock, type StockLine } from "./stock";

export type OrderLifecycleErrorCode = "not_found" | "invalid_transition" | "order_changed";

export class OrderLifecycleError extends Error {
  constructor(
    public code: OrderLifecycleErrorCode,
    /** The order's status at the moment the change was refused (what the caller should now show). */
    public currentStatus?: OrderStatusValue,
  ) {
    super(code);
    this.name = "OrderLifecycleError";
  }
}

/** The body staff send to move an order. `expectedStatus` is what their screen showed: if someone else moved it first, nothing happens. */
export const staffTransitionSchema = z
  .object({
    to: z.enum(ORDER_STATUSES),
    expectedStatus: z.enum(ORDER_STATUSES),
    reason: z
      .string()
      .trim()
      .max(ORDER_REASON_MAX)
      .transform((v) => (v === "" ? null : v))
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict();
export type StaffTransition = z.output<typeof staffTransitionSchema>;

export const customerCancelSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(ORDER_REASON_MAX)
      .transform((v) => (v === "" ? null : v))
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict();

export interface TransitionRequest {
  number: number;
  to: OrderStatusValue;
  by: OrderActorType;
  /** Set by customers: the order must belong to them (anything else is "not found", like a missing order). */
  customerId?: string;
  expectedStatus?: OrderStatusValue;
  /** The staff member's e-mail for audit and history (staff only). */
  actorLabel?: string | null;
  reason?: string | null;
}

export interface TransitionResult {
  number: number;
  from: OrderStatusValue;
  to: OrderStatusValue;
  /** Products whose stock changed (their public availability may need refreshing). */
  productIds: string[];
}

const TX = { timeout: 30_000, maxWait: 10_000 };
const MAX_ATTEMPTS = 3;

/**
 * Moves orders along their life (see `order-status.ts`): confirm, reject, cancel, prepare, ship, deliver. Each change is ONE
 * transaction that (1) flips the status with `UPDATE … WHERE status = <what we read>`, so two staff members (or a customer and
 * staff) acting at once cannot both succeed, (2) gives the reserved stock back exactly once when the order ends rejected or
 * cancelled, (3) writes the history entry and the audit log. If anything fails nothing changed.
 */
export class OrderLifecycleService {
  constructor(
    private readonly db: Db,
    /** Called AFTER a change that moved stock, with the affected products (the app refreshes their public availability). */
    private readonly onStockChanged: (productIds: string[]) => void = () => undefined,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async transition(request: TransitionRequest): Promise<TransitionResult> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const result = await this.attempt(request);
        if (result.productIds.length > 0) this.onStockChanged(result.productIds);
        return result;
      } catch (error) {
        // A deadlock or write conflict between concurrent transactions is rolled back by PostgreSQL: simply try again.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }

  private attempt(request: TransitionRequest): Promise<TransitionResult> {
    const now = this.clock();
    return this.db.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { number: request.number }, include: { items: true } });
      if (!order || (request.customerId !== undefined && order.customerId !== request.customerId)) throw new OrderLifecycleError("not_found");
      const from = order.status;
      if (request.expectedStatus !== undefined && request.expectedStatus !== from) throw new OrderLifecycleError("order_changed", from);
      if (!canTransition(from, request.to, request.by)) throw new OrderLifecycleError("invalid_transition", from);

      const moved = await tx.order.updateMany({ where: { id: order.id, status: from }, data: { status: request.to, updatedAt: now } });
      if (moved.count === 0) {
        const now2 = await tx.order.findUnique({ where: { id: order.id }, select: { status: true } });
        throw new OrderLifecycleError("order_changed", now2?.status);
      }

      const give: StockLine[] = [];
      if (releasesStock(request.to)) {
        for (const item of order.items) {
          if (item.reservedQuantity <= 0) continue;
          // Claim the line's hold: only the transaction that zeroes it gives the units back, so a unit is returned once, ever.
          const claim = await tx.orderItem.updateMany({ where: { id: item.id, reservedQuantity: { gt: 0 } }, data: { reservedQuantity: 0 } });
          if (claim.count === 1) give.push({ productId: item.productId, sku: item.skuSnapshot, quantity: item.reservedQuantity });
        }
        await releaseStock(tx, give, now);
      }

      await tx.orderStatusEvent.create({
        data: { orderId: order.id, fromStatus: from, toStatus: request.to, actorType: request.by, actorLabel: request.by === "staff" ? (request.actorLabel ?? null) : null, reason: request.reason ?? null, createdAt: now },
      });
      await tx.auditLog.create({
        data: {
          // A customer's phone number is never written to the audit log; their id is enough to find the account.
          actorEmail: request.by === "staff" ? (request.actorLabel ?? "staff") : request.by === "customer" ? `customer:${order.customerId}` : "system",
          action: `order.${request.to}`,
          entity: "order",
          entityId: order.id,
          detail: { number: order.number, from, to: request.to, released: give.reduce((n, l) => n + l.quantity, 0) },
          at: now,
        },
      });
      return { number: order.number, from, to: request.to, productIds: [...new Set(give.map((l) => l.productId))] };
    }, TX);
  }

  /** Orders waiting for a decision: what the admin's "new orders" indicator shows. */
  async pendingSummary(): Promise<{ pending: number; newestPlacedAt: string | null }> {
    const [pending, newest] = await Promise.all([
      this.db.order.count({ where: { status: "pending" } }),
      this.db.order.findFirst({ where: { status: "pending" }, orderBy: { placedAt: "desc" }, select: { placedAt: true } }),
    ]);
    return { pending, newestPlacedAt: newest ? newest.placedAt.toISOString() : null };
  }
}

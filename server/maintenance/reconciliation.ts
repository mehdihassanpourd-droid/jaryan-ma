import type { OrderStatusValue } from "../../src/domain/customer/order-status";
import { reconcile, type ReconOptions, type ReconOrder, type ReconReport, type ReconStock } from "../../src/domain/maintenance/reconciliation";
import type { Db } from "../db/client";

/**
 * Reads orders and stock for the reconciliation report. STRICTLY READ-ONLY: only `findMany`, and only the columns the
 * comparison needs (no customer, address, phone or note column is selected). `server/invariants.test.ts` fails if this file
 * ever calls a writing method.
 */
export async function loadReconciliationInput(db: Db, limits: { maxOrders?: number } = {}): Promise<{ orders: ReconOrder[]; stock: ReconStock[] }> {
  const rows = await db.order.findMany({
    orderBy: { number: "desc" },
    take: limits.maxOrders ?? 5000,
    select: {
      number: true, status: true, placedAt: true, subtotalToman: true, shippingFeeToman: true, totalToman: true,
      items: { select: { productId: true, skuSnapshot: true, quantity: true, unitPriceToman: true, reservedQuantity: true } },
      statusHistory: { orderBy: { seq: "desc" }, take: 1, select: { toStatus: true } },
    },
  });
  const orders: ReconOrder[] = rows.map((o) => ({
    number: o.number,
    status: o.status as OrderStatusValue,
    placedAt: o.placedAt,
    subtotal: o.subtotalToman,
    shippingFee: o.shippingFeeToman,
    total: o.totalToman,
    lastHistoryStatus: (o.statusHistory[0]?.toStatus as OrderStatusValue | undefined) ?? null,
    items: o.items.map((i) => ({ productId: i.productId, sku: i.skuSnapshot, quantity: i.quantity, unitPrice: i.unitPriceToman, reservedQuantity: i.reservedQuantity })),
  }));

  const products = await db.product.findMany({ select: { id: true, fulfillment: true, inventory: true, variants: { select: { sku: true, inventory: true } } } });
  const stock: ReconStock[] = [];
  for (const p of products) {
    const stocked = p.fulfillment !== "made_to_order";
    if (p.variants.length > 0) for (const v of p.variants) stock.push({ productId: p.id, sku: v.sku, inventory: v.inventory, stocked });
    else stock.push({ productId: p.id, sku: null, inventory: p.inventory, stocked });
  }
  return { orders, stock };
}

export async function buildReconciliationReport(db: Db, options: ReconOptions): Promise<ReconReport> {
  const { orders, stock } = await loadReconciliationInput(db);
  return reconcile(orders, stock, options);
}

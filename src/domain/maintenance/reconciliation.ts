import type { OrderStatusValue } from "../customer/order-status";

/**
 * Read-only reconciliation of orders against stock. It only COMPARES numbers that the database already holds and reports
 * differences for a person to look at; nothing here (or in its callers) changes an order, a payment or an inventory count.
 * Findings carry order NUMBERS, product ids and SKUs only: never names, phone numbers, addresses or notes.
 */
export type FindingSeverity = "error" | "warn" | "info";

export type FindingCode =
  | "order_total_mismatch"
  | "order_subtotal_mismatch"
  | "reserved_exceeds_quantity"
  | "reserved_on_closed_order"
  | "negative_inventory"
  | "status_history_missing"
  | "status_history_mismatch"
  | "pending_order_stale"
  | "unreserved_stocked_line";

export interface ReconOrderItem {
  productId: string;
  sku: string | null;
  quantity: number;
  /** Toman, BigInt-exact. */
  unitPrice: bigint;
  reservedQuantity: number;
}

export interface ReconOrder {
  number: number;
  status: OrderStatusValue;
  placedAt: Date;
  subtotal: bigint;
  shippingFee: bigint;
  total: bigint;
  items: ReconOrderItem[];
  /** The newest status event's target status, or null when the order has no history at all. */
  lastHistoryStatus: OrderStatusValue | null;
}

export interface ReconStock {
  productId: string;
  sku: string | null;
  /** null = not tracked (made to order, or carried by variants). */
  inventory: number | null;
  stocked: boolean;
}

export interface ReconFinding {
  code: FindingCode;
  severity: FindingSeverity;
  message: string;
  orderNumber?: number;
  productId?: string;
  sku?: string | null;
}

export interface StockSummaryRow {
  productId: string;
  sku: string | null;
  inventory: number;
  /** Units currently held by open (pending/confirmed/preparing/shipped) orders. */
  reservedByOpenOrders: number;
}

export interface ReconReport {
  generatedAt: string;
  readOnly: true;
  counts: { orders: number; openOrders: number; stockRows: number; error: number; warn: number; info: number };
  findings: ReconFinding[];
  stock: StockSummaryRow[];
}

export interface ReconOptions {
  now: Date;
  /** A pending order older than this is flagged (nobody confirmed or rejected it). Default 72 hours. */
  pendingStaleHours?: number;
}

const OPEN: readonly OrderStatusValue[] = ["pending", "confirmed", "preparing", "shipped"];
const CLOSED_WITHOUT_STOCK: readonly OrderStatusValue[] = ["cancelled", "rejected"];

export function reconcile(orders: readonly ReconOrder[], stock: readonly ReconStock[], options: ReconOptions): ReconReport {
  const findings: ReconFinding[] = [];
  const staleMs = (options.pendingStaleHours ?? 72) * 3600_000;
  const reserved = new Map<string, number>();

  for (const order of orders) {
    const lines = order.items.reduce((sum, item) => sum + item.unitPrice * BigInt(item.quantity), 0n);
    if (lines !== order.subtotal) findings.push({ code: "order_subtotal_mismatch", severity: "error", orderNumber: order.number, message: `order ${order.number}: stored subtotal ${order.subtotal} differs from the lines (${lines})` });
    if (order.subtotal + order.shippingFee !== order.total) findings.push({ code: "order_total_mismatch", severity: "error", orderNumber: order.number, message: `order ${order.number}: total ${order.total} is not subtotal ${order.subtotal} + shipping ${order.shippingFee}` });

    for (const item of order.items) {
      if (item.reservedQuantity > item.quantity) findings.push({ code: "reserved_exceeds_quantity", severity: "error", orderNumber: order.number, productId: item.productId, sku: item.sku, message: `order ${order.number}: ${item.reservedQuantity} unit(s) reserved for a line of ${item.quantity}` });
      if (CLOSED_WITHOUT_STOCK.includes(order.status) && item.reservedQuantity > 0) findings.push({ code: "reserved_on_closed_order", severity: "error", orderNumber: order.number, productId: item.productId, sku: item.sku, message: `order ${order.number} is ${order.status} but still holds ${item.reservedQuantity} reserved unit(s) (release did not happen)` });
      if (OPEN.includes(order.status)) {
        const key = `${item.productId}|${item.sku ?? ""}`;
        reserved.set(key, (reserved.get(key) ?? 0) + item.reservedQuantity);
        const tracked = stock.find((s) => s.productId === item.productId && (s.sku ?? "") === (item.sku ?? ""));
        if (tracked?.stocked && item.reservedQuantity === 0) findings.push({ code: "unreserved_stocked_line", severity: "info", orderNumber: order.number, productId: item.productId, sku: item.sku, message: `order ${order.number}: a stocked line holds no reservation (normal for orders made before reservations existed)` });
      }
    }

    if (order.lastHistoryStatus === null) findings.push({ code: "status_history_missing", severity: "warn", orderNumber: order.number, message: `order ${order.number} has no status history` });
    else if (order.lastHistoryStatus !== order.status) findings.push({ code: "status_history_mismatch", severity: "error", orderNumber: order.number, message: `order ${order.number} is ${order.status} but its history ends at ${order.lastHistoryStatus}` });
    if (order.status === "pending" && options.now.getTime() - order.placedAt.getTime() > staleMs) findings.push({ code: "pending_order_stale", severity: "warn", orderNumber: order.number, message: `order ${order.number} has been pending for more than ${options.pendingStaleHours ?? 72} hours` });
  }

  const summary: StockSummaryRow[] = [];
  for (const row of stock) {
    if (row.inventory === null) continue;
    if (row.inventory < 0) findings.push({ code: "negative_inventory", severity: "error", productId: row.productId, sku: row.sku, message: `product ${row.productId}${row.sku ? ` (${row.sku})` : ""}: inventory is ${row.inventory}` });
    summary.push({ productId: row.productId, sku: row.sku, inventory: row.inventory, reservedByOpenOrders: reserved.get(`${row.productId}|${row.sku ?? ""}`) ?? 0 });
  }

  const rank = { error: 0, warn: 1, info: 2 } as const;
  findings.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.orderNumber ?? 0) - (b.orderNumber ?? 0));
  const count = (s: FindingSeverity) => findings.filter((f) => f.severity === s).length;
  return {
    generatedAt: options.now.toISOString(),
    readOnly: true,
    counts: { orders: orders.length, openOrders: orders.filter((o) => OPEN.includes(o.status)).length, stockRows: summary.length, error: count("error"), warn: count("warn"), info: count("info") },
    findings,
    stock: summary,
  };
}

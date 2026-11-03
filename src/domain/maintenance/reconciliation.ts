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

/** How much of the shop a report actually looked at. A partial report must never be read as "everything is fine". */
export interface ReconScan {
  /** "recent": the newest orders up to a limit (default, cheap). "full": every order, page by page (CLI only). */
  mode: "recent" | "full";
  ordersScanned: number;
  /** The most orders a "recent" scan reads (null for "full"). */
  orderLimit: number | null;
  /** True when older orders exist that this report did NOT check. */
  partial: boolean;
  oldestOrderNumberScanned: number | null;
  stockRowsScanned: number;
  /** True when some products were not read (page cap reached). */
  stockPartial: boolean;
  pagesRead: number;
  /** Human-readable statement, safe to show verbatim. */
  note: string;
}

export interface ReconReport {
  generatedAt: string;
  readOnly: true;
  scan: ReconScan;
  counts: { orders: number; openOrders: number; stockRows: number; error: number; warn: number; info: number };
  /** At most MAX_FINDINGS are listed; `counts` always holds the true totals. */
  findingsTruncated: boolean;
  findings: ReconFinding[];
  stock: StockSummaryRow[];
}

export interface ReconOptions {
  now: Date;
  /** A pending order older than this is flagged (nobody confirmed or rejected it). Default 72 hours. */
  pendingStaleHours?: number;
}

export const MAX_FINDINGS = 2000;
const MAX_UNRESERVED_TRACKED = 5000;
const OPEN: readonly OrderStatusValue[] = ["pending", "confirmed", "preparing", "shipped"];
const CLOSED_WITHOUT_STOCK: readonly OrderStatusValue[] = ["cancelled", "rejected"];

/**
 * Accumulates a reconciliation page by page, so a full scan never needs every order in memory at once: per-order checks run
 * as each page arrives, and only small aggregates (open reservations per SKU, a bounded list of unreserved lines) are kept.
 */
export class ReconAccumulator {
  private readonly findings: ReconFinding[] = [];
  private readonly counts = { error: 0, warn: 0, info: 0 };
  private orders = 0;
  private openOrders = 0;
  private readonly reserved = new Map<string, number>();
  private readonly unreserved: Array<{ order: number; productId: string; sku: string | null }> = [];
  private unreservedOverflow = 0;
  private readonly stock: ReconStock[] = [];
  private readonly staleMs: number;

  constructor(private readonly options: ReconOptions) {
    this.staleMs = (options.pendingStaleHours ?? 72) * 3600_000;
  }

  private add(finding: ReconFinding) {
    this.counts[finding.severity]++;
    if (this.findings.length < MAX_FINDINGS) this.findings.push(finding);
  }

  addOrders(orders: readonly ReconOrder[]): void {
    for (const order of orders) {
      this.orders++;
      if (OPEN.includes(order.status)) this.openOrders++;
      const lines = order.items.reduce((sum, item) => sum + item.unitPrice * BigInt(item.quantity), 0n);
      if (lines !== order.subtotal) this.add({ code: "order_subtotal_mismatch", severity: "error", orderNumber: order.number, message: `order ${order.number}: stored subtotal ${order.subtotal} differs from the lines (${lines})` });
      if (order.subtotal + order.shippingFee !== order.total) this.add({ code: "order_total_mismatch", severity: "error", orderNumber: order.number, message: `order ${order.number}: total ${order.total} is not subtotal ${order.subtotal} + shipping ${order.shippingFee}` });

      for (const item of order.items) {
        if (item.reservedQuantity > item.quantity) this.add({ code: "reserved_exceeds_quantity", severity: "error", orderNumber: order.number, productId: item.productId, sku: item.sku, message: `order ${order.number}: ${item.reservedQuantity} unit(s) reserved for a line of ${item.quantity}` });
        if (CLOSED_WITHOUT_STOCK.includes(order.status) && item.reservedQuantity > 0) this.add({ code: "reserved_on_closed_order", severity: "error", orderNumber: order.number, productId: item.productId, sku: item.sku, message: `order ${order.number} is ${order.status} but still holds ${item.reservedQuantity} reserved unit(s) (release did not happen)` });
        if (OPEN.includes(order.status)) {
          const key = `${item.productId}|${item.sku ?? ""}`;
          this.reserved.set(key, (this.reserved.get(key) ?? 0) + item.reservedQuantity);
          if (item.reservedQuantity === 0) {
            if (this.unreserved.length < MAX_UNRESERVED_TRACKED) this.unreserved.push({ order: order.number, productId: item.productId, sku: item.sku });
            else this.unreservedOverflow++;
          }
        }
      }

      if (order.lastHistoryStatus === null) this.add({ code: "status_history_missing", severity: "warn", orderNumber: order.number, message: `order ${order.number} has no status history` });
      else if (order.lastHistoryStatus !== order.status) this.add({ code: "status_history_mismatch", severity: "error", orderNumber: order.number, message: `order ${order.number} is ${order.status} but its history ends at ${order.lastHistoryStatus}` });
      if (order.status === "pending" && this.options.now.getTime() - order.placedAt.getTime() > this.staleMs) this.add({ code: "pending_order_stale", severity: "warn", orderNumber: order.number, message: `order ${order.number} has been pending for more than ${this.options.pendingStaleHours ?? 72} hours` });
    }
  }

  addStock(rows: readonly ReconStock[]): void {
    this.stock.push(...rows);
  }

  finish(scan: ReconScan): ReconReport {
    const stocked = new Map(this.stock.map((s) => [`${s.productId}|${s.sku ?? ""}`, s.stocked]));
    for (const u of this.unreserved) {
      if (stocked.get(`${u.productId}|${u.sku ?? ""}`)) this.add({ code: "unreserved_stocked_line", severity: "info", orderNumber: u.order, productId: u.productId, sku: u.sku, message: `order ${u.order}: a stocked line holds no reservation (normal for orders made before reservations existed)` });
    }
    const summary: StockSummaryRow[] = [];
    for (const row of this.stock) {
      if (row.inventory === null) continue;
      if (row.inventory < 0) this.add({ code: "negative_inventory", severity: "error", productId: row.productId, sku: row.sku, message: `product ${row.productId}${row.sku ? ` (${row.sku})` : ""}: inventory is ${row.inventory}` });
      summary.push({ productId: row.productId, sku: row.sku, inventory: row.inventory, reservedByOpenOrders: this.reserved.get(`${row.productId}|${row.sku ?? ""}`) ?? 0 });
    }
    const rank = { error: 0, warn: 1, info: 2 } as const;
    const sorted = [...this.findings].sort((a, b) => rank[a.severity] - rank[b.severity] || (a.orderNumber ?? 0) - (b.orderNumber ?? 0));
    const truncated = sorted.length < this.counts.error + this.counts.warn + this.counts.info;
    return {
      generatedAt: this.options.now.toISOString(),
      readOnly: true,
      scan,
      counts: { orders: this.orders, openOrders: this.openOrders, stockRows: summary.length, ...this.counts },
      findingsTruncated: truncated,
      findings: sorted,
      stock: summary,
    };
  }
}

/** The describing sentence for a scan; written once so every surface says the same thing. */
export function scanNote(scan: Omit<ReconScan, "note">): string {
  if (scan.mode === "full" && !scan.partial && !scan.stockPartial) return `Full scan: all ${scan.ordersScanned} order(s) were checked.`;
  const parts: string[] = [];
  if (scan.partial) parts.push(`PARTIAL: only the newest ${scan.ordersScanned} order(s) were checked${scan.oldestOrderNumberScanned !== null ? ` (down to order number ${scan.oldestOrderNumberScanned})` : ""}; older orders were NOT checked. Run \`ops reconcile --full\` for a complete scan.`);
  if (scan.stockPartial) parts.push("PARTIAL: not every product was read, so inventory findings may be missing.");
  return parts.length > 0 ? parts.join(" ") : `All ${scan.ordersScanned} order(s) were checked.`;
}

/** Pure convenience for tests and small data sets: everything in memory, scan reported as complete unless `partial` is given. */
export function reconcile(orders: readonly ReconOrder[], stock: readonly ReconStock[], options: ReconOptions & { partial?: boolean; orderLimit?: number | null }): ReconReport {
  const acc = new ReconAccumulator(options);
  acc.addOrders(orders);
  acc.addStock(stock);
  const base = {
    mode: (options.orderLimit ?? null) === null ? ("full" as const) : ("recent" as const),
    ordersScanned: orders.length,
    orderLimit: options.orderLimit ?? null,
    partial: options.partial ?? false,
    oldestOrderNumberScanned: orders.length > 0 ? Math.min(...orders.map((o) => o.number)) : null,
    stockRowsScanned: stock.length,
    stockPartial: false,
    pagesRead: 1,
  };
  return acc.finish({ ...base, note: scanNote(base) });
}

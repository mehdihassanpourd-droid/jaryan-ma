import type { OrderStatusValue } from "../../src/domain/customer/order-status";
import { ReconAccumulator, scanNote, type ReconOptions, type ReconOrder, type ReconReport, type ReconScan, type ReconStock } from "../../src/domain/maintenance/reconciliation";
import type { Db } from "../db/client";

/**
 * Reads orders and stock for the reconciliation report. STRICTLY READ-ONLY: only `findMany`/`findFirst`, and only the columns
 * the comparison needs (no customer, address, phone or note column is selected). `server/invariants.test.ts` fails if this
 * file ever calls a writing method.
 *
 * Every query is BOUNDED: orders and products are read in keyset pages (`number < cursor`, `id > cursor`; both indexed) of at
 * most MAX_PAGE_SIZE rows, never with an unbounded `findMany`. The default scan ("recent") stops after `orderLimit` orders
 * and says so in the report; the "full" scan walks every page up to `maxPages` and optionally pauses between pages so a big
 * shop can be scanned off-peak without starving the application of connections.
 */
export const DEFAULT_ORDER_LIMIT = 5000;
export const DEFAULT_PAGE_SIZE = 250;
export const MAX_PAGE_SIZE = 500;
export const DEFAULT_MAX_PAGES = 400;

export interface ScanOptions extends ReconOptions {
  mode?: "recent" | "full";
  /** "recent" only: stop after this many orders (default 5000). */
  orderLimit?: number;
  pageSize?: number;
  /** Hard cap on pages read per table (orders, products). Default 400 (100,000 rows at the default page size). */
  maxPages?: number;
  /** Sleep between pages (ms), to be gentle on a busy database. Default 0. */
  pauseMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export async function loadOrderPage(db: Db, page: { beforeNumber: number | null; take: number }): Promise<ReconOrder[]> {
  const rows = await db.order.findMany({
    where: page.beforeNumber === null ? {} : { number: { lt: page.beforeNumber } },
    orderBy: { number: "desc" },
    take: Math.max(1, Math.min(page.take, MAX_PAGE_SIZE)),
    select: {
      number: true, status: true, placedAt: true, subtotalToman: true, shippingFeeToman: true, totalToman: true,
      items: { select: { productId: true, skuSnapshot: true, quantity: true, unitPriceToman: true, reservedQuantity: true } },
      statusHistory: { orderBy: { seq: "desc" }, take: 1, select: { toStatus: true } },
    },
  });
  return rows.map((o) => ({
    number: o.number,
    status: o.status as OrderStatusValue,
    placedAt: o.placedAt,
    subtotal: o.subtotalToman,
    shippingFee: o.shippingFeeToman,
    total: o.totalToman,
    lastHistoryStatus: (o.statusHistory[0]?.toStatus as OrderStatusValue | undefined) ?? null,
    items: o.items.map((i) => ({ productId: i.productId, sku: i.skuSnapshot, quantity: i.quantity, unitPrice: i.unitPriceToman, reservedQuantity: i.reservedQuantity })),
  }));
}

export async function loadStockPage(db: Db, page: { afterId: string | null; take: number }): Promise<{ rows: ReconStock[]; lastId: string | null; count: number }> {
  const products = await db.product.findMany({
    where: page.afterId === null ? {} : { id: { gt: page.afterId } },
    orderBy: { id: "asc" },
    take: Math.max(1, Math.min(page.take, MAX_PAGE_SIZE)),
    select: { id: true, fulfillment: true, inventory: true, variants: { select: { sku: true, inventory: true } } },
  });
  const rows: ReconStock[] = [];
  for (const p of products) {
    const stocked = p.fulfillment !== "made_to_order";
    if (p.variants.length > 0) for (const v of p.variants) rows.push({ productId: p.id, sku: v.sku, inventory: v.inventory, stocked });
    else rows.push({ productId: p.id, sku: null, inventory: p.inventory, stocked });
  }
  return { rows, lastId: products.at(-1)?.id ?? null, count: products.length };
}

export async function buildReconciliationReport(db: Db, options: ScanOptions): Promise<ReconReport> {
  const mode = options.mode ?? "recent";
  const pageSize = Math.max(1, Math.min(options.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);
  const orderLimit = mode === "recent" ? Math.max(1, options.orderLimit ?? DEFAULT_ORDER_LIMIT) : null;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pause = async () => void (options.pauseMs && options.pauseMs > 0 && (await sleep(options.pauseMs)));
  const acc = new ReconAccumulator(options);

  let scanned = 0;
  let pages = 0;
  let before: number | null = null;
  let oldest: number | null = null;
  let exhausted = false;
  while (pages < maxPages && !exhausted) {
    const take = orderLimit === null ? pageSize : Math.min(pageSize, orderLimit - scanned);
    if (take <= 0) break;
    const orders = await loadOrderPage(db, { beforeNumber: before, take });
    pages++;
    if (orders.length === 0) {
      exhausted = true;
      break;
    }
    acc.addOrders(orders);
    scanned += orders.length;
    before = orders.at(-1)?.number ?? before;
    oldest = before;
    if (orders.length < take) exhausted = true;
    else await pause();
  }
  // Is anything older left? (one indexed lookup; this is what makes "partial" an honest statement)
  const partial = !exhausted && before !== null && (await db.order.findFirst({ where: { number: { lt: before } }, select: { number: true } })) !== null;

  let stockRows = 0;
  let stockPages = 0;
  let afterId: string | null = null;
  let stockExhausted = false;
  while (stockPages < maxPages && !stockExhausted) {
    const page = await loadStockPage(db, { afterId, take: pageSize });
    stockPages++;
    if (page.count === 0) {
      stockExhausted = true;
      break;
    }
    acc.addStock(page.rows);
    stockRows += page.rows.length;
    afterId = page.lastId;
    if (page.count < pageSize) stockExhausted = true;
    else await pause();
  }
  const stockPartial = !stockExhausted && afterId !== null && (await db.product.findFirst({ where: { id: { gt: afterId } }, select: { id: true } })) !== null;

  const scan: Omit<ReconScan, "note"> = { mode, ordersScanned: scanned, orderLimit, partial, oldestOrderNumberScanned: oldest, stockRowsScanned: stockRows, stockPartial, pagesRead: pages + stockPages };
  return acc.finish({ ...scan, note: scanNote(scan) });
}

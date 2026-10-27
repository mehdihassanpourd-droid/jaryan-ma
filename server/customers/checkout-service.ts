import { MAX_OPEN_ORDERS, type CheckoutRequest, type LineProblem } from "../../src/domain/customer/checkout";
import { newOrderSchema } from "../../src/domain/customer/schema";
import { lineTotal, MoneyRangeError, sumToman } from "../../src/domain/money";
import type { CatalogRepository } from "../../src/domain/product/ports";
import type { StoredProduct } from "../../src/domain/product/types";

type StockedProduct = StoredProduct;
import type { AccountStore, OrderView } from "./account-ports";
import type { CustomerStore } from "./ports";
import { StockConflictError } from "../orders/stock";

export type CheckoutErrorCode = "items_unavailable" | "too_many_open_orders" | "order_total_out_of_range" | "account_not_active";

export class CheckoutError extends Error {
  constructor(
    public code: CheckoutErrorCode,
    /** Per-line reasons for `items_unavailable`. */
    public problems: LineProblem[] = [],
  ) {
    super(code);
    this.name = "CheckoutError";
  }
}

export interface PlacedOrder {
  order: OrderView;
  /** False when this checkout attempt had already created the order (a retry): nothing new was written. */
  created: boolean;
}

/**
 * Turns a cart (product, variant, quantity) into a PENDING order. Everything that matters is decided HERE from the
 * database, never from the browser: which products are published, their titles and exact prices, whether they can be
 * ordered, and the total. No payment is taken. The order RESERVES its stock in the same transaction that creates it
 * (`UPDATE … WHERE inventory >= quantity`, see `orders/stock.ts`): two shoppers can never both get the last unit, and the
 * units come back automatically if the order is rejected or cancelled. Made-to-order lines have no stock to reserve.
 */
export class CheckoutService {
  constructor(
    private readonly catalog: Pick<CatalogRepository, "getPublishedBySlugs">,
    private readonly accounts: AccountStore,
    private readonly customers: CustomerStore,
    /** The vendor that sells the catalogue this service reads (every order line carries a vendor: multi-vendor readiness). */
    private readonly vendorId: string,
    private readonly clock: () => Date = () => new Date(),
    /** Called after an order took stock: the affected products' public availability may have changed (e.g. a unique piece is now sold). */
    private readonly onStockChanged: (productIds: string[]) => void = () => undefined,
  ) {}

  async placeOrder(customerId: string, request: CheckoutRequest): Promise<PlacedOrder> {
    const customer = await this.customers.findById(customerId);
    if (!customer || customer.status !== "active") throw new CheckoutError("account_not_active");

    // A retry of an attempt that already succeeded returns that order, whatever has changed in the catalogue since.
    const earlier = await this.accounts.findOrderByRequestId(customerId, request.requestId);
    if (earlier) return { order: earlier, created: false };

    if ((await this.accounts.countOpenOrders(customerId)) >= MAX_OPEN_ORDERS) throw new CheckoutError("too_many_open_orders");

    const products = new Map((await this.catalog.getPublishedBySlugs([...new Set(request.items.map((l) => l.slug))])).map((p) => [p.slug, p]));
    const problems: LineProblem[] = [];
    const items = [];
    for (const line of request.items) {
      const product = products.get(line.slug);
      const found: ReturnType<CheckoutService["priceLine"]> = product ? this.priceLine(product, line.sku, line.quantity) : { problem: "not_found" };
      if ("problem" in found) {
        problems.push({ slug: line.slug, sku: line.sku, reason: found.problem, ...(found.available !== undefined ? { available: found.available } : {}) });
        continue;
      }
      items.push({
        productId: found.product.id,
        vendorId: this.vendorId,
        titleSnapshot: found.product.name,
        skuSnapshot: found.sku,
        variantSnapshot: found.options,
        imageKeySnapshot: [...found.product.images].sort((a, b) => a.position - b.position)[0]?.key ?? null,
        unitPriceToman: found.unitPriceToman,
        quantity: line.quantity,
        reserveStock: found.product.fulfillment !== "made_to_order",
      });
    }
    if (problems.length > 0) throw new CheckoutError("items_unavailable", problems);

    let total: number;
    try {
      total = sumToman(items.map((i) => lineTotal(i.unitPriceToman, i.quantity)));
    } catch (error) {
      if (error instanceof MoneyRangeError) throw new CheckoutError("order_total_out_of_range");
      throw error;
    }

    const input = newOrderSchema.parse({ customerId, items, shipping: request.shipping, customerNote: request.customerNote, requestId: request.requestId, totalToman: total });
    try {
      const placed = await this.accounts.placeOrderOnce({ ...input, requestId: request.requestId }, this.clock());
      if (placed.created) this.onStockChanged([...new Set(input.items.filter((i) => i.reserveStock).map((i) => i.productId))]);
      return placed;
    } catch (error) {
      // Someone else took the stock between our check and the reservation (the reservation is the authority): say which lines.
      if (error instanceof StockConflictError) throw new CheckoutError("items_unavailable", await this.problemsAfterConflict(request, error, products));
      throw error;
    }
  }

  /** Re-reads the catalogue to explain which lines lost the race and how many units are left (never reports a line as fine). */
  private async problemsAfterConflict(request: CheckoutRequest, conflict: StockConflictError, before: Map<string, StockedProduct>): Promise<LineProblem[]> {
    const fresh = new Map((await this.catalog.getPublishedBySlugs([...before.keys()])).map((p) => [p.slug, p]));
    const failedKeys = new Set(conflict.failed.map((f) => `${f.productId}|${f.sku ?? ""}`));
    const problems: LineProblem[] = [];
    for (const line of request.items) {
      const product = before.get(line.slug);
      if (!product || !failedKeys.has(`${product.id}|${line.sku ?? ""}`)) continue;
      const now = fresh.get(line.slug);
      const again: { problem: LineProblem["reason"]; available?: number } = now ? (() => { const r = this.priceLine(now, line.sku, line.quantity); return "problem" in r ? r : { problem: "sold_out" as const }; })() : { problem: "not_found" };
      problems.push({ slug: line.slug, sku: line.sku, reason: again.problem, ...(again.available !== undefined ? { available: again.available } : {}) });
    }
    return problems.length > 0 ? problems : conflict.failed.map((f) => ({ slug: [...before.values()].find((p) => p.id === f.productId)?.slug ?? "", sku: f.sku, reason: "sold_out" as const }));
  }

  /** One line against the product as stored: the exact unit price and whether `quantity` of it can be ordered now. */
  private priceLine(
    product: StoredProduct,
    sku: string | null,
    quantity: number,
  ):
    | { product: StoredProduct; sku: string | null; options: Record<string, string> | null; unitPriceToman: number }
    | { problem: LineProblem["reason"]; available?: number } {
    const variants = [...product.variants].sort((a, b) => a.position - b.position);
    let unit = product.priceToman;
    let stock: number | null = product.inventory;
    let options: Record<string, string> | null = null;
    let chosenSku: string | null = null;

    if (variants.length > 0) {
      if (sku === null) return { problem: "variant_required" };
      const variant = variants.find((v) => v.sku === sku);
      if (!variant) return { problem: "variant_not_found" };
      unit = variant.priceToman ?? product.priceToman;
      stock = variant.inventory;
      options = variant.options;
      chosenSku = variant.sku;
    } else if (sku !== null) {
      return { problem: "variant_not_found" };
    }

    if (unit === null || unit <= 0) return { problem: "no_price" };
    if (product.fulfillment === "unique" && quantity !== 1) return { problem: "quantity_not_allowed" };
    if (product.fulfillment !== "made_to_order") {
      const available = stock ?? 0;
      if (available <= 0) return { problem: "sold_out" };
      if (quantity > available) return { problem: "insufficient_stock", available };
    }
    return { product, sku: chosenSku, options, unitPriceToman: unit };
  }
}

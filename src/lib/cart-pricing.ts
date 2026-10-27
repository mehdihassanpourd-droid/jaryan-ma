import { MAX_LINE_QUANTITY } from "@/domain/customer/checkout";
import { lineTotal } from "@/domain/money";
import type { PublicProduct } from "@/domain/product/snapshot";
import type { CartLine } from "./cart";

/** Why a cart line cannot be ordered right now. */
export type UnavailableReason = "not_found" | "variant_not_found" | "sold_out" | "no_price";

export type PricedLine =
  | {
      ok: true;
      line: CartLine;
      product: PublicProduct;
      /** Readable variant choice (e.g. "۵۰×۷۰"), empty for a product without variants. */
      variantLabel: string;
      unitPriceToman: number;
      /** Exact (BigInt): price × quantity can exceed what a JavaScript number holds exactly. */
      totalToman: bigint;
      /** The quantity actually priced (a unique piece is always one). */
      quantity: number;
      madeToOrder: boolean;
    }
  | { ok: false; line: CartLine; product: PublicProduct | null; reason: UnavailableReason };

/** Highest quantity the shopper may ask for on one line (stock counts are not public: the server has the final word). */
export const quantityLimit = (product: Pick<PublicProduct, "fulfillment">): number => (product.fulfillment === "unique" ? 1 : MAX_LINE_QUANTITY);

/** Prices one cart line against the CURRENT published product. `product` null = not (or no longer) published. */
export function priceLine(line: CartLine, product: PublicProduct | null): PricedLine {
  if (!product) return { ok: false, line, product: null, reason: "not_found" };
  let unit = product.priceToman;
  let available = product.availability !== "sold_out";
  let variantLabel = "";
  if (product.variants.length > 0) {
    const variant = product.variants.find((v) => v.sku === line.sku);
    if (!variant) return { ok: false, line, product, reason: "variant_not_found" };
    unit = variant.priceToman;
    available = variant.available;
    variantLabel = Object.values(variant.options).join("، ");
  } else if (line.sku !== null) {
    return { ok: false, line, product, reason: "variant_not_found" };
  }
  if (unit === null || unit <= 0) return { ok: false, line, product, reason: "no_price" };
  if (!available) return { ok: false, line, product, reason: "sold_out" };
  const quantity = Math.min(line.quantity, quantityLimit(product));
  return { ok: true, line, product, variantLabel, unitPriceToman: unit, totalToman: lineTotal(unit, quantity), quantity, madeToOrder: product.fulfillment === "made_to_order" };
}

/** Exact sum of the orderable lines. */
export const cartTotal = (priced: readonly PricedLine[]): bigint => priced.reduce((sum, p) => (p.ok ? sum + p.totalToman : sum), 0n);

export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  not_found: "این محصول در حال حاضر در فروشگاه نیست.",
  variant_not_found: "این گزینه دیگر وجود ندارد.",
  sold_out: "ناموجود شده است.",
  no_price: "قیمت این محصول هنوز اعلام نشده است.",
};

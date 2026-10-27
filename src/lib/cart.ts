import { MAX_LINE_QUANTITY, MAX_ORDER_LINES } from "@/domain/customer/checkout";
import { isLiveSlug } from "@/lib/live-catalog";

/**
 * The shopper's cart: only WHICH products (and variant) and HOW MANY, in the browser's own storage. Prices, titles,
 * images and availability are never stored: they are read from the live catalogue every time the cart is shown, so a
 * cart can never display (or later submit) a stale or tampered price. Nothing personal is kept here.
 */
export interface CartLine {
  slug: string;
  /** The variant's SKU; null for a product without variants. */
  sku: string | null;
  quantity: number;
}

export const CART_STORAGE_KEY = "jm-cart-v1";

export const lineKey = (line: Pick<CartLine, "slug" | "sku">) => `${line.slug}|${line.sku ?? ""}`;

const clampQuantity = (quantity: number) => Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.trunc(quantity)));

/** Reads whatever is in storage defensively: anything malformed is dropped, duplicates are merged, limits enforced. */
export function parseCart(raw: string | null): CartLine[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const merged = new Map<string, CartLine>();
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) continue;
    const { slug, sku, quantity } = entry as Record<string, unknown>;
    if (typeof slug !== "string" || !isLiveSlug(slug)) continue;
    if (sku !== null && (typeof sku !== "string" || sku.length < 1 || sku.length > 64)) continue;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 1) continue;
    const line: CartLine = { slug, sku: sku ?? null, quantity: clampQuantity(quantity) };
    const known = merged.get(lineKey(line));
    if (known) known.quantity = clampQuantity(known.quantity + line.quantity);
    else if (merged.size < MAX_ORDER_LINES) merged.set(lineKey(line), line);
  }
  return [...merged.values()];
}

export const serializeCart = (lines: readonly CartLine[]): string => JSON.stringify(lines);

/** Adds `quantity` to the line (merging with an existing one), never above the per-line limit or the line count limit. */
export function addLine(lines: readonly CartLine[], add: CartLine): CartLine[] {
  const key = lineKey(add);
  if (lines.some((l) => lineKey(l) === key)) return lines.map((l) => (lineKey(l) === key ? { ...l, quantity: clampQuantity(l.quantity + add.quantity) } : l));
  if (lines.length >= MAX_ORDER_LINES) return [...lines];
  return [...lines, { ...add, quantity: clampQuantity(add.quantity) }];
}

export function setLineQuantity(lines: readonly CartLine[], key: string, quantity: number): CartLine[] {
  return lines.map((l) => (lineKey(l) === key ? { ...l, quantity: clampQuantity(quantity) } : l));
}

export const removeLine = (lines: readonly CartLine[], key: string): CartLine[] => lines.filter((l) => lineKey(l) !== key);

export const cartCount = (lines: readonly CartLine[]): number => lines.reduce((sum, l) => sum + l.quantity, 0);

import type { Prisma } from "../../src/generated/prisma/client";

export type Tx = Prisma.TransactionClient;

/** One order line's claim on stock: a variant (by SKU) or, without `sku`, the product itself. */
export interface StockLine {
  productId: string;
  sku: string | null;
  quantity: number;
}

/** At least one line could not be reserved: the stock was gone (or the product no longer published) by the time we asked. */
export class StockConflictError extends Error {
  constructor(public readonly failed: StockLine[]) {
    super("stock_conflict");
    this.name = "StockConflictError";
  }
}

const byKey = (a: StockLine, b: StockLine) => (a.productId + "|" + (a.sku ?? "")).localeCompare(b.productId + "|" + (b.sku ?? ""));

/** Lines merged by (product, sku) and put in the one global order every transaction uses. */
function normalise(lines: readonly StockLine[]): StockLine[] {
  const merged = new Map<string, StockLine>();
  for (const l of lines) {
    const key = `${l.productId}|${l.sku ?? ""}`;
    const known = merged.get(key);
    if (known) known.quantity += l.quantity;
    else merged.set(key, { ...l });
  }
  return [...merged.values()].sort(byKey);
}

/**
 * Locks the product rows (always in id order, and BEFORE any variant row, the same order the admin's product update uses, so
 * the two can never wait on each other) and bumps their version: a concurrent admin edit that started from the old numbers
 * then fails with a version conflict instead of silently overwriting the stock an order just reserved.
 * `onlyPublished` makes an unpublished or missing product count as 0 rows.
 */
async function lockProducts(tx: Tx, ids: string[], now: Date, onlyPublished: boolean): Promise<Set<string>> {
  const locked = new Set<string>();
  for (const id of [...new Set(ids)].sort()) {
    const r = await tx.product.updateMany({ where: { id, ...(onlyPublished ? { status: "published" } : {}) }, data: { version: { increment: 1 }, updatedAt: now } });
    if (r.count === 1) locked.add(id);
  }
  return locked;
}

/**
 * Takes `quantity` out of each line's stock, atomically: `UPDATE … WHERE inventory >= quantity` either gets the units or
 * touches nothing, and PostgreSQL serialises concurrent updates of the same row, so two orders can never both get the last
 * unit. Throws `StockConflictError` (the caller's transaction then rolls everything back) listing the lines that failed.
 */
export async function reserveStock(tx: Tx, lines: readonly StockLine[], now: Date): Promise<void> {
  const wanted = normalise(lines);
  if (wanted.length === 0) return;
  const locked = await lockProducts(tx, wanted.map((l) => l.productId), now, true);
  const failed: StockLine[] = [];
  for (const line of wanted) {
    if (!locked.has(line.productId)) {
      failed.push(line);
      continue;
    }
    const r = line.sku
      ? await tx.productVariant.updateMany({ where: { sku: line.sku, productId: line.productId, inventory: { gte: line.quantity } }, data: { inventory: { decrement: line.quantity } } })
      : await tx.product.updateMany({ where: { id: line.productId, inventory: { gte: line.quantity } }, data: { inventory: { decrement: line.quantity } } });
    if (r.count !== 1) failed.push(line);
  }
  if (failed.length > 0) throw new StockConflictError(failed);
}

/**
 * Gives reserved units back. A unique piece never goes above 1 (the database allows only 0 or 1 for it), and a product whose
 * stock is no longer tracked (turned made-to-order, variant removed) is simply skipped: nothing to give back to.
 */
export async function releaseStock(tx: Tx, lines: readonly StockLine[], now: Date): Promise<void> {
  const give = normalise(lines).filter((l) => l.quantity > 0);
  if (give.length === 0) return;
  await lockProducts(tx, give.map((l) => l.productId), now, false);
  for (const line of give) {
    if (line.sku) {
      await tx.productVariant.updateMany({ where: { sku: line.sku, productId: line.productId, inventory: { not: null } }, data: { inventory: { increment: line.quantity } } });
    } else {
      // A unique piece comes back as exactly one (the database only allows 0 or 1 for it, even if staff already re-stocked it by hand).
      await tx.product.updateMany({ where: { id: line.productId, fulfillment: "unique", inventory: { not: null } }, data: { inventory: 1 } });
      await tx.product.updateMany({ where: { id: line.productId, fulfillment: { not: "unique" }, inventory: { not: null } }, data: { inventory: { increment: line.quantity } } });
    }
  }
}

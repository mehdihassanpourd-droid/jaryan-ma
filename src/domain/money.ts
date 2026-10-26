/**
 * Money: whole Toman, never floats.
 *
 * Storage is PostgreSQL BIGINT, so sums and totals can never overflow in the database. In the application
 * (domain, API, JSON, CSV, public snapshots) amounts are JavaScript numbers bounded by MAX_TOMAN. JSON numbers
 * are exact only up to 2^53, and a browser's JSON.parse silently rounds anything larger; keeping every amount
 * below that bound means no amount can ever be silently corrupted on its way through the system. Values outside
 * the bound are rejected loudly at every boundary instead.
 *
 * 10^15 Toman is far beyond any real price (and leaves ample headroom for inflation), yet 9x below 2^53.
 * Raising the bound later means moving this one module to bigint/string amounts; the database needs no change.
 */
export const MAX_TOMAN = 1_000_000_000_000_000;

export class MoneyRangeError extends RangeError {
  constructor(message = "money_out_of_range") {
    super(message);
    this.name = "MoneyRangeError";
  }
}

/** True for a whole, non-negative amount within the supported range. */
export function isToman(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOMAN;
}

/** Application number -> database BIGINT. Throws instead of rounding. */
export function tomanToDb(amount: number): bigint {
  if (!isToman(amount)) throw new MoneyRangeError();
  return BigInt(amount);
}

/** Database BIGINT -> application number. Throws if the stored value is outside the exact range. */
export function tomanFromDb(amount: bigint): number {
  if (amount < 0n || amount > BigInt(MAX_TOMAN)) throw new MoneyRangeError();
  return Number(amount);
}

export const tomanToDbOrNull = (amount: number | null): bigint | null => (amount === null ? null : tomanToDb(amount));
export const tomanFromDbOrNull = (amount: bigint | null): number | null => (amount === null ? null : tomanFromDb(amount));

/** Exact unit price x quantity, computed in BigInt (a product of two valid amounts can exceed 2^53). */
export function lineTotal(unitToman: number, quantity: number): bigint {
  if (!isToman(unitToman) || !Number.isSafeInteger(quantity) || quantity < 1) throw new MoneyRangeError();
  return BigInt(unitToman) * BigInt(quantity);
}

/** Exact sum, checked against the supported range. Returns the application number. */
export function sumToman(parts: bigint[]): number {
  const total = parts.reduce((a, b) => a + b, 0n);
  if (total < 0n || total > BigInt(MAX_TOMAN)) throw new MoneyRangeError("order_total_out_of_range");
  return Number(total);
}

/** Sizes (bytes etc.) stored as BIGINT but exposed as numbers; same loud failure outside the exact range. */
export function bigintToSafeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyRangeError("number_out_of_range");
  return Number(value);
}

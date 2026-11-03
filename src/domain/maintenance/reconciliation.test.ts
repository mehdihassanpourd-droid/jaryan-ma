import { describe, expect, it } from "vitest";
import { MAX_FINDINGS, ReconAccumulator, reconcile, scanNote, type ReconOrder, type ReconStock } from "./reconciliation";

const now = new Date("2026-03-10T12:00:00Z");
const order = (over: Partial<ReconOrder> = {}): ReconOrder => ({
  number: 100001, status: "pending", placedAt: new Date("2026-03-10T10:00:00Z"), subtotal: 300_000n, shippingFee: 50_000n, total: 350_000n, lastHistoryStatus: "pending",
  items: [{ productId: "p1", sku: null, quantity: 3, unitPrice: 100_000n, reservedQuantity: 3 }], ...over,
});
const stock = (over: Partial<ReconStock> = {}): ReconStock => ({ productId: "p1", sku: null, inventory: 7, stocked: true, ...over });
const codes = (o: ReconOrder[], s: ReconStock[] = [stock()]) => reconcile(o, s, { now }).findings.map((f) => f.code);

describe("reconciliation", () => {
  it("a consistent shop has no findings and is marked read-only", () => {
    const r = reconcile([order()], [stock()], { now });
    expect(r.findings).toEqual([]);
    expect(r.readOnly).toBe(true);
    expect(r.counts).toMatchObject({ orders: 1, openOrders: 1, error: 0 });
    expect(r.stock).toEqual([{ productId: "p1", sku: null, inventory: 7, reservedByOpenOrders: 3 }]);
  });

  it("flags totals that do not add up (BigInt-exact, beyond 2^53)", () => {
    const big = 9_000_000_000_000_001n;
    expect(codes([order({ total: 349_999n })])).toEqual(["order_total_mismatch"]);
    expect(codes([order({ subtotal: 299_999n, total: 349_999n })])).toEqual(["order_subtotal_mismatch"]);
    const exact = order({ subtotal: big, total: big + 50_000n, items: [{ productId: "p1", sku: null, quantity: 1, unitPrice: big, reservedQuantity: 1 }] });
    expect(codes([exact])).toEqual([]);
    expect(codes([{ ...exact, total: big + 50_001n }])).toEqual(["order_total_mismatch"]);
  });

  it("flags reservations that exceed the line, or that a cancelled/rejected order still holds", () => {
    const items = (reservedQuantity: number) => [{ productId: "p1", sku: null, quantity: 3, unitPrice: 100_000n, reservedQuantity }];
    expect(codes([order({ items: items(4) })])).toContain("reserved_exceeds_quantity");
    for (const status of ["cancelled", "rejected"] as const) expect(codes([order({ status, lastHistoryStatus: status, items: items(3) })])).toEqual(["reserved_on_closed_order"]);
    expect(codes([order({ status: "cancelled", lastHistoryStatus: "cancelled", items: items(0) })])).toEqual([]);
    expect(codes([order({ status: "delivered", lastHistoryStatus: "delivered", items: items(3) })])).toEqual([]); // consumed stock stays recorded
  });

  it("flags negative inventory but ignores untracked stock", () => {
    expect(codes([], [stock({ inventory: -1 })])).toEqual(["negative_inventory"]);
    expect(reconcile([], [stock({ inventory: null, stocked: false })], { now }).stock).toEqual([]);
  });

  it("compares the order with its newest history event", () => {
    expect(codes([order({ lastHistoryStatus: null })])).toEqual(["status_history_missing"]);
    expect(codes([order({ status: "confirmed", lastHistoryStatus: "pending" })])).toEqual(["status_history_mismatch"]);
  });

  it("flags a pending order only after the threshold", () => {
    expect(codes([order({ placedAt: new Date("2026-03-07T11:59:00Z") })])).toEqual(["pending_order_stale"]);
    expect(reconcile([order({ placedAt: new Date("2026-03-09T11:00:00Z") })], [stock()], { now, pendingStaleHours: 12 }).findings.map((f) => f.code)).toEqual(["pending_order_stale"]);
    expect(codes([order({ placedAt: new Date("2026-03-10T11:00:00Z") })])).toEqual([]);
  });

  it("notes unreserved stocked lines as information only", () => {
    const r = reconcile([order({ items: [{ productId: "p1", sku: null, quantity: 1, unitPrice: 100_000n, reservedQuantity: 0 }], subtotal: 100_000n, total: 150_000n })], [stock()], { now });
    expect(r.findings).toMatchObject([{ code: "unreserved_stocked_line", severity: "info" }]);
    expect(r.counts.info).toBe(1);
  });

  it("sorts errors first and names only order numbers, product ids and SKUs", () => {
    const r = reconcile([order({ number: 5, lastHistoryStatus: null }), order({ number: 9, total: 1n })], [stock({ productId: "p2", sku: "SKU-1", inventory: -2 })], { now });
    expect(r.findings.map((f) => f.severity)).toEqual(["error", "error", "warn"]);
    expect(JSON.stringify(r)).not.toMatch(/phone|address|email/i);
  });

  it("aggregates reservations per variant sku", () => {
    const items = [{ productId: "p1", sku: "A", quantity: 2, unitPrice: 1n, reservedQuantity: 2 }, { productId: "p1", sku: "B", quantity: 1, unitPrice: 1n, reservedQuantity: 1 }];
    const r = reconcile([order({ items, subtotal: 3n, shippingFee: 0n, total: 3n })], [stock({ sku: "A", inventory: 4 }), stock({ sku: "B", inventory: 9 })], { now });
    expect(r.stock).toEqual([{ productId: "p1", sku: "A", inventory: 4, reservedByOpenOrders: 2 }, { productId: "p1", sku: "B", inventory: 9, reservedByOpenOrders: 1 }]);
  });

  it("states what was scanned: complete by default for in-memory data, partial when told so", () => {
    const full = reconcile([order()], [stock()], { now });
    expect(full.scan).toMatchObject({ mode: "full", ordersScanned: 1, partial: false, orderLimit: null, oldestOrderNumberScanned: 100001 });
    expect(full.scan.note).toContain("Full scan");
    const recent = reconcile([order({ number: 7 }), order({ number: 9 })], [stock()], { now, orderLimit: 2, partial: true });
    expect(recent.scan).toMatchObject({ mode: "recent", orderLimit: 2, partial: true, oldestOrderNumberScanned: 7 });
    expect(recent.scan.note).toContain("PARTIAL");
    expect(recent.scan.note).toContain("older orders were NOT checked");
    expect(recent.scan.note).toContain("--full");
  });

  it("describes a partial stock scan", () => {
    const note = scanNote({ mode: "full", ordersScanned: 1, orderLimit: null, partial: false, oldestOrderNumberScanned: 1, stockRowsScanned: 1, stockPartial: true, pagesRead: 2 });
    expect(note).toContain("not every product was read");
  });

  it("page-by-page accumulation gives exactly the same result as one pass", () => {
    const orders = Array.from({ length: 10 }, (_, i) => order({ number: 200 - i, total: i % 3 === 0 ? 1n : 350_000n, lastHistoryStatus: i % 4 === 0 ? null : "pending" }));
    const once = reconcile(orders, [stock()], { now });
    const acc = new ReconAccumulator({ now });
    for (let i = 0; i < orders.length; i += 3) acc.addOrders(orders.slice(i, i + 3));
    acc.addStock([stock()]);
    const paged = acc.finish(once.scan);
    expect(paged).toEqual(once);
  });

  it("caps the listed findings but keeps the true counts and says so", () => {
    const many = Array.from({ length: MAX_FINDINGS + 50 }, (_, i) => order({ number: i + 1, total: 1n }));
    const r = reconcile(many, [stock()], { now });
    expect(r.findings).toHaveLength(MAX_FINDINGS);
    expect(r.counts.error).toBeGreaterThanOrEqual(MAX_FINDINGS + 50);
    expect(r.findingsTruncated).toBe(true);
    expect(reconcile([order()], [stock()], { now }).findingsTruncated).toBe(false);
  });
});

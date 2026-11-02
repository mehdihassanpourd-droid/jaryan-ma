import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SecurityFacts } from "../../src/domain/maintenance/security-checks";
import { AlertManager, type AlertSink, type DeliveredAlert } from "../alerts/alerts";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { ensureDefaultVendor } from "../db/vendor";
import { PrismaMaintenanceStore } from "./prisma-store";
import { buildReconciliationReport } from "./reconciliation";
import { MaintenanceError, MaintenanceService, type HealthProbes, type Operator } from "./service";

let testDb: TestDatabase;
let store: PrismaMaintenanceStore;
let now: Date;
let dbUp: boolean;
const owner: Operator = { email: "owner@example.com", role: "owner" };
const support: Operator = { email: "support@example.com", role: "support" };
const facts: SecurityFacts = {
  production: true, encryptionKeyConfigured: true, cookieSecure: true, requireTotp: true, adminOrigins: ["https://admin.example.ir"], storageDriver: "s3",
  databaseIsEmbedded: false, trustProxy: true, customerAccountsEnabled: false, smsProvider: "disabled", publicMediaUrl: "https://media.example.ir", devAdminConfigured: false,
};
const probes = (): HealthProbes => ({
  database: async () => { if (!dbUp) throw new Error("postgresql://u:secret@10.0.0.9/db refused"); },
  migrations: async () => ({ name: "migrations", status: "ok", message: "all migrations applied" }),
  storage: async () => undefined,
  security: () => facts,
  reconciliation: (at) => buildReconciliationReport(testDb.db, { now: at }),
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  store = new PrismaMaintenanceStore(testDb.db);
}, 60_000);
afterAll(async () => testDb.close());
beforeEach(async () => {
  await testDb.reset();
  now = new Date("2026-03-10T12:00:00.000Z");
  dbUp = true;
});

/** Orders as the real system would leave them, plus deliberately damaged ones. */
async function seed() {
  const { db } = testDb;
  const vendorId = await ensureDefaultVendor(db);
  const customer = await db.customer.create({ data: { phone: "+989121234567", status: "active", termsAcceptedAt: now, termsVersion: "1", phoneVerifiedAt: now } });
  const product = await db.product.create({ data: { vendorId, slug: "vase", name: "گلدان", status: "published", fulfillment: "stocked", priceToman: 100_000n, inventory: 7 } });
  const shipping = { recipientName: "علی", province: "تهران", city: "تهران", phone: "09121234567" };
  const mk = (over: { total: bigint; status?: "pending" | "cancelled"; reserved: number; history?: "pending" | "cancelled" }) =>
    db.order.create({
      data: {
        customerId: customer.id, status: over.status ?? "pending", subtotalToman: 300_000n, shippingFeeToman: 50_000n, totalToman: over.total, shipping, placedAt: new Date(now.getTime() - 3600_000),
        items: { create: [{ productId: product.id, vendorId, titleSnapshot: "گلدان", unitPriceToman: 100_000n, quantity: 3, reservedQuantity: over.reserved }] },
        statusHistory: { create: { toStatus: over.history ?? over.status ?? "pending", actorType: "system" } },
      },
    });
  await mk({ total: 350_000n, reserved: 3 }); // healthy
  await mk({ total: 349_000n, reserved: 3 }); // total mismatch
  await mk({ total: 350_000n, status: "cancelled", reserved: 3 }); // cancelled but still reserved
  return { product };
}

const snapshot = async () => ({
  orders: await testDb.db.order.findMany({ orderBy: { number: "asc" } }),
  items: await testDb.db.orderItem.findMany({ orderBy: { id: "asc" } }),
  products: await testDb.db.product.findMany({ orderBy: { id: "asc" } }),
  history: await testDb.db.orderStatusEvent.count(),
  log: await testDb.db.maintenanceLog.count(),
});

describe("reconciliation report on a real database", () => {
  it("finds the damaged orders (the database itself refuses negative stock), and changes NOTHING (orders, items, inventory, history)", async () => {
    await seed();
    const before = await snapshot();
    const report = await buildReconciliationReport(testDb.db, { now });
    expect(report.counts).toMatchObject({ orders: 3, openOrders: 2 });
    expect(report.findings.map((f) => f.code).sort()).toEqual(["order_total_mismatch", "reserved_on_closed_order"]);
    expect(report.stock.find((s) => s.inventory === 7)).toMatchObject({ reservedByOpenOrders: 6 });
    expect(await snapshot()).toEqual(before);
  });

  it("is empty for a consistent shop and never contains personal data", async () => {
    const { db } = testDb;
    await seed();
    await db.order.deleteMany({ where: { OR: [{ totalToman: 349_000n }, { status: "cancelled" }] } });
    const report = await buildReconciliationReport(db, { now });
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/09121234567|\+98912|علی|recipient|گلدان/);
  });

  it("is available to the owner only and records that it ran (counts only)", async () => {
    await seed();
    const svc = new MaintenanceService(store, probes(), undefined, () => now);
    await expect(svc.reconciliationFor(support)).rejects.toMatchObject({ code: "forbidden" });
    const report = await svc.reconciliationFor(owner);
    expect(report.counts.error).toBe(2);
    const entry = (await store.listLog({ action: "reconciliation.run" }, 5))[0];
    expect(entry).toMatchObject({ actor: "owner@example.com", outcome: "failure", detail: { orders: 3, error: 2 } });
    const unavailable = new MaintenanceService(store, { ...probes(), reconciliation: undefined }, undefined, () => now);
    await expect(unavailable.reconciliationFor(owner)).rejects.toBeInstanceOf(MaintenanceError);
  });
});

describe("readiness", () => {
  it("is ready only when the database answers; reveals no error text", async () => {
    const svc = new MaintenanceService(store, probes(), undefined, () => now);
    expect(await svc.runReadiness()).toMatchObject({ ready: true, checks: [{ name: "database", status: "ok" }, { name: "migrations", status: "ok" }] });
    dbUp = false;
    const down = await svc.runReadiness();
    expect(down.ready).toBe(false);
    expect(down.checks).toEqual([{ name: "database", status: "fail" }, { name: "migrations", status: "fail" }]);
    expect(JSON.stringify(down)).not.toMatch(/secret|10\.0\.0\.9|postgresql/);
  });

  it("does not write to storage or touch the maintenance tables", async () => {
    let storageCalls = 0;
    const svc = new MaintenanceService(store, { ...probes(), storage: async () => void storageCalls++ }, undefined, () => now);
    await svc.runReadiness();
    expect(storageCalls).toBe(0);
    expect(await testDb.db.maintenanceLog.count()).toBe(0);
  });
});

describe("alerts from the health cycle", () => {
  it("raises one P0 when the database goes down, nothing on repeat, and a resolution when it recovers", async () => {
    const got: DeliveredAlert[] = [];
    const sink: AlertSink = { name: "rec", deliver: async (a) => void got.push(a) };
    const svc = new MaintenanceService(store, probes(), undefined, () => now, new AlertManager([sink], { now: () => now }));
    await svc.healthCycle(); // healthy: nothing
    expect(got).toHaveLength(0);
    dbUp = false;
    await svc.healthCycle();
    await svc.healthCycle();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ priority: "P0", state: "firing", key: "health.unhealthy", source: "health_check" });
    expect(JSON.stringify(got)).not.toMatch(/secret|10\.0\.0\.9/);
    dbUp = true;
    await svc.healthCycle();
    expect(got.map((a) => a.state)).toEqual(["firing", "resolved"]);
  });

  it("a broken sink never breaks the health cycle", async () => {
    const sink: AlertSink = { name: "bad", deliver: async () => { throw new Error("down"); } };
    dbUp = false;
    const svc = new MaintenanceService(store, probes(), undefined, () => now, new AlertManager([sink]));
    await expect(svc.healthCycle()).resolves.toMatchObject({ status: "down" });
  });
});

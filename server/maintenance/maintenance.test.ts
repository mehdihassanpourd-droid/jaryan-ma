import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SecurityFacts } from "../../src/domain/maintenance/security-checks";
import { incidentCreateSchema, incidentUpdateSchema } from "../../src/domain/maintenance/incident";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { PrismaMaintenanceStore } from "./prisma-store";
import { MaintenanceError, MaintenanceService, scrubDetail, type HealthProbes, type Operator } from "./service";

let testDb: TestDatabase;
let store: PrismaMaintenanceStore;
let svc: MaintenanceService;
let now: Date;
let dbUp: boolean;
let storageUp: boolean;
const owner: Operator = { email: "owner@example.com", role: "owner" };
const support: Operator = { email: "support@example.com", role: "support" };
const editor: Operator = { email: "editor@example.com", role: "editor" };

const facts: SecurityFacts = {
  production: true, encryptionKeyConfigured: true, cookieSecure: true, requireTotp: true, adminOrigins: ["https://admin.example.ir"], storageDriver: "s3",
  databaseIsEmbedded: false, trustProxy: true, customerAccountsEnabled: false, smsProvider: "disabled", publicMediaUrl: "https://media.example.ir", devAdminConfigured: false,
};
const probes: HealthProbes = {
  database: async () => {
    if (!dbUp) throw new Error("postgresql://u:secret@10.0.0.9/db refused");
  },
  migrations: async () => ({ name: "migrations", status: "ok", message: "all migrations applied" }),
  storage: async () => {
    if (!storageUp) throw new Error("no route");
  },
  security: () => facts,
};

const hour = 3600_000;
const fail = async <T>(p: Promise<T>) => (await p.then(() => null, (e: unknown) => e)) as MaintenanceError | null;
const backup = (over: Record<string, unknown> = {}) => ({ kind: "database" as const, takenAt: new Date(now.getTime() - hour), sizeBytes: 12_345_678, location: "/var/backups/jaryan/db-1.dump.enc", encrypted: true, ...over });

beforeAll(async () => {
  testDb = await createTestDatabase();
  store = new PrismaMaintenanceStore(testDb.db);
}, 60_000);
afterAll(async () => testDb.close());

beforeEach(async () => {
  await testDb.reset();
  now = new Date("2026-03-10T12:00:00.000Z");
  dbUp = true;
  storageUp = true;
  svc = new MaintenanceService(store, probes, undefined, () => now);
});

describe("backups: operational only after a successful restore test", () => {
  it("walks none -> untested -> operational and drops on failure or staleness", async () => {
    expect((await svc.backupStatus()).database).toMatchObject({ state: "none", operational: false });
    const b = await svc.recordBackup(owner, backup());
    expect((await svc.backupStatus()).database).toMatchObject({ state: "untested", operational: false });

    await svc.recordRestoreTest(owner, b.id, true, "restored into scratch DB, 3 tables compared");
    expect((await svc.backupStatus()).database).toMatchObject({ state: "operational", operational: true });
    expect((await svc.backupStatus()).media.operational).toBe(false); // media has its own, untouched status

    now = new Date(now.getTime() + 2 * 24 * hour);
    expect((await svc.backupStatus()).database.state).toBe("stale_backup");

    await svc.recordBackup(owner, backup({ takenAt: new Date(now.getTime() - hour) }));
    expect((await svc.backupStatus()).database.state).toBe("operational"); // earlier successful test still within 35 days

    const latest = (await svc.listBackups(owner, "database"))[0]!;
    await svc.recordRestoreTest(owner, latest.id, false, "pg_restore failed");
    expect((await svc.backupStatus()).database).toMatchObject({ state: "restore_failed", operational: false });
    expect((await store.findOpenIncident("backup"))?.severity).toBe("major");
  });

  it("rejects impossible backups and unknown ids", async () => {
    expect(await fail(svc.recordBackup(owner, backup({ takenAt: new Date(now.getTime() + hour) })))).toMatchObject({ code: "validation" });
    expect(await fail(svc.recordBackup(owner, backup({ sizeBytes: 0 })))).toMatchObject({ code: "validation" });
    expect(await fail(svc.recordRestoreTest(owner, "00000000-0000-0000-0000-000000000000", true))).toMatchObject({ code: "not_found" });
  });

  it("never stores credentials in the location or notes", async () => {
    const b = await svc.recordBackup(owner, backup({ location: "s3://key:pw@host/bucket/db.dump" }));
    expect(b.location).toBe("s3://[credentials]@host/bucket/db.dump");
    expect((await svc.recordBackup(owner, backup())).location).toBe("/var/backups/jaryan/db-1.dump.enc");
    await svc.recordRestoreTest(owner, b.id, true, "used postgresql://u:hunter2@h/db");
    expect(JSON.stringify(await store.listBackups("database", 5))).not.toContain("hunter2");
  });

  it("reports the health check as warn while untested and fail when the restore failed", async () => {
    const b = await svc.recordBackup(owner, backup());
    expect((await svc.runHealth()).checks.find((c) => c.name === "backup")).toMatchObject({ status: "warn" });
    await svc.recordRestoreTest(owner, b.id, false);
    expect((await svc.runHealth()).checks.find((c) => c.name === "backup")).toMatchObject({ status: "fail" });
  });
});

describe("health", () => {
  it("is ok when everything works and the backup is verified", async () => {
    const b = await svc.recordBackup(owner, backup());
    await svc.recordRestoreTest(owner, b.id, true);
    const r = await svc.runHealth();
    expect(r.status).toBe("ok");
    expect(r.checks.map((c) => c.name)).toEqual(expect.arrayContaining(["database", "migrations", "storage", "backup", "errors"]));
  });

  it("is down when the database is unreachable, without leaking the error text", async () => {
    dbUp = false;
    const r = await svc.runHealth();
    expect(r.status).toBe("down");
    expect(JSON.stringify(r)).not.toMatch(/secret|10\.0\.0\.9|postgresql/);
  });

  it("is degraded when only storage fails", async () => {
    storageUp = false;
    expect((await svc.runHealth()).status).toBe("degraded");
  });

  it("opens one incident per outage and resolves it on recovery", async () => {
    dbUp = false;
    await svc.healthCycle();
    await svc.healthCycle();
    now = new Date(now.getTime() + 5 * 60_000);
    await svc.healthCycle();
    let open = await svc.listIncidents(owner, { open: true });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ severity: "critical", source: "health_check", createdBy: "system" });
    dbUp = true;
    now = new Date(now.getTime() + 5 * 60_000);
    await svc.healthCycle();
    open = await svc.listIncidents(owner, { open: true });
    expect(open).toHaveLength(0);
    const resolved = await svc.getIncident(owner, 1);
    expect(resolved.status).toBe("resolved");
    expect(resolved.updates.map((u) => u.status)).toEqual(["investigating", "resolved"]);
    expect((await svc.listLog(owner)).map((l) => l.action)).toEqual(expect.arrayContaining(["incident.auto_opened", "incident.auto_resolved"]));
  });
});

describe("incidents", () => {
  it("are created, updated through valid transitions, and logged", async () => {
    const i = await svc.createIncident(owner, incidentCreateSchema.parse({ title: "قطعی پیامک", severity: "major", source: "manual", summary: "درگاه پاسخ نمی‌دهد" }));
    expect(i).toMatchObject({ number: 1, status: "investigating" });
    await svc.updateIncident(owner, i.number, incidentUpdateSchema.parse({ status: "identified", message: "مشکل از سمت درگاه است" }));
    expect(await fail(svc.updateIncident(owner, i.number, incidentUpdateSchema.parse({ status: "identified", message: "تکرار" })))).toMatchObject({ code: "invalid_transition" });
    now = new Date(now.getTime() + hour);
    await svc.updateIncident(owner, i.number, incidentUpdateSchema.parse({ status: "resolved", message: "رفع شد" }));
    const d = await svc.getIncident(owner, i.number);
    expect(d).toMatchObject({ status: "resolved", resolvedAt: now });
    expect(d.updates).toHaveLength(3);
    expect(await fail(svc.updateIncident(owner, 99, incidentUpdateSchema.parse({ message: "x" })))).toMatchObject({ code: "not_found" });
  });

  it("clamps a future start time to now", async () => {
    const i = await svc.createIncident(owner, incidentCreateSchema.parse({ title: "آینده", severity: "minor", startedAt: new Date(now.getTime() + 10 * hour) }));
    expect(i.startedAt).toEqual(now);
  });
});

describe("error reports", () => {
  it("de-duplicates by fingerprint, counts, reopens, and stores nothing sensitive", async () => {
    const report = (n: number) => ({ source: "server" as const, environment: "production", name: "Error", message: `order ${n} failed for ali@example.com 09121234567`, stack: `Error\n    at pay (/app/pay.js:${n}:3)\n    postgresql://u:pw@h/db` , url: "https://shop.example/x?token=SECRET" });
    const a = await svc.reportError(report(1));
    const b = await svc.reportError(report(2));
    expect(b.id).toBe(a.id);
    expect(b.count).toBe(2);
    await svc.resolveError(owner, a.id);
    expect((await svc.listErrors(owner, { resolved: false })).length).toBe(0);
    await svc.reportError(report(3));
    expect((await svc.listErrors(owner, { resolved: false }))[0]).toMatchObject({ count: 3, resolved: false });
    const stored = JSON.stringify(await store.listErrors({}, 10));
    expect(stored).not.toMatch(/ali@example|09121234567|SECRET|u:pw|\bpw@/);
    expect(await svc.reportError({ source: "storefront", environment: "production", name: "Error", message: "different" })).toMatchObject({ count: 1 });
  });

  it("feeds the health 'errors' check", async () => {
    for (let i = 0; i < 6; i++) await svc.reportError({ source: "server", environment: "production", name: "Error", message: `distinct problem ${"abcdefg"[i]}${"x".repeat(i)} word${"q".repeat(i + 1)}` });
    expect((await svc.runHealth()).checks.find((c) => c.name === "errors")?.status).toBe("warn");
  });

  it("prunes only old resolved reports and very old log entries", async () => {
    const a = await svc.reportError({ source: "server", environment: "production", message: "old resolved" });
    await svc.resolveError(owner, a.id);
    await svc.reportError({ source: "server", environment: "production", message: "old unresolved thing" });
    await svc.logAction("deploy", "deploy.old", null, "success");
    now = new Date(now.getTime() + 401 * 24 * hour);
    await svc.logAction("deploy", "deploy.new", null, "success");
    expect(await svc.prune()).toEqual({ errors: 1, log: 2 });
    expect((await svc.listErrors(owner)).map((e) => e.message)).toEqual(["old unresolved thing"]);
    expect((await svc.listLog(owner)).map((l) => l.action)).toEqual(["deploy.new"]);
  });
});

describe("maintenance audit log", () => {
  it("records operational actions with secrets scrubbed", async () => {
    await svc.logAction("deploy-bot", "deploy", "release:abc123", "failure", { error: "connect postgresql://u:pw@h/db failed", apiToken: "SECRET", nested: { password: "x", ok: 1 } });
    const [row] = await svc.listLog(owner, { action: "deploy" });
    expect(row).toMatchObject({ actor: "deploy-bot", outcome: "failure", target: "release:abc123" });
    const s = JSON.stringify(row?.detail);
    expect(s).not.toMatch(/u:pw|SECRET|"x"/);
    expect(s).toContain('"ok":1');
    expect(scrubDetail({ a: [1, "ali@example.com"] })).toEqual({ a: [1, "[email]"] });
  });
});

describe("role-based access", () => {
  it("only the owner operates; support and editor cannot read or write maintenance data", async () => {
    for (const who of [support, editor]) {
      expect(await fail(svc.listIncidents(who))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.createIncident(who, incidentCreateSchema.parse({ title: "abc", severity: "minor" })))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.recordBackup(who, backup()))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.listLog(who))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.listErrors(who))).toMatchObject({ code: "forbidden" });
      expect(await fail(svc.resolveError(who, "x"))).toMatchObject({ code: "forbidden" });
    }
  });
});

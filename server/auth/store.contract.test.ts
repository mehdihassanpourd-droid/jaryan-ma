import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { MemoryAdminStore } from "./memory-store";
import { PrismaAdminStore } from "./prisma-store";
import { AccountExistsError, type AdminStore } from "./ports";

/** The same behavioural contract must hold for every AdminStore implementation. */
function contract(name: string, setup: () => Promise<{ store: AdminStore; reset(): Promise<void>; close(): Promise<void> }>) {
  describe(`AdminStore contract: ${name}`, () => {
    let store: AdminStore;
    let env: Awaited<ReturnType<typeof setup>>;
    const t0 = new Date("2026-03-01T10:00:00.000Z");
    const later = (ms: number) => new Date(t0.getTime() + ms);

    beforeAll(async () => {
      env = await setup();
      store = env.store;
    }, 60_000);
    afterAll(async () => env.close());
    beforeEach(async () => env.reset());

    const account = () => store.createAccount({ email: "owner@example.test", passwordHash: "hash-1", role: "owner", totpSecretEnc: null });
    const session = (userId: string, tokenHash: string, expiresAt = later(3600_000)) =>
      store.createSession({ userId, tokenHash, csrfToken: "csrf", createdAt: t0, lastSeenAt: t0, expiresAt, ip: "10.0.0.1", userAgent: "test" });

    it("creates and finds accounts by email and id; emails are unique", async () => {
      const a = await account();
      expect(a).toMatchObject({ email: "owner@example.test", role: "owner", disabled: false, failedLogins: 0, lockedUntil: null, totpSecretEnc: null, totpLastStep: null });
      expect(await store.findByEmail("owner@example.test")).toMatchObject({ id: a.id });
      expect(await store.findById(a.id)).toMatchObject({ email: "owner@example.test" });
      expect(await store.findByEmail("nobody@example.test")).toBeNull();
      await expect(account()).rejects.toBeInstanceOf(AccountExistsError);
    });

    it("lists accounts", async () => {
      await account();
      await store.createAccount({ email: "a@example.test", passwordHash: "h", role: "viewer", totpSecretEnc: null });
      expect((await store.listAccounts()).map((a) => a.email)).toEqual(expect.arrayContaining(["a@example.test", "owner@example.test"]));
    });

    it("updates password, TOTP and disabled flag", async () => {
      const a = await account();
      await store.setPassword(a.id, "hash-2", t0);
      await store.setTotp(a.id, "sealed");
      await store.setDisabled(a.id, true);
      expect(await store.findById(a.id)).toMatchObject({ passwordHash: "hash-2", totpSecretEnc: "sealed", disabled: true });
      await store.setTotp(a.id, null);
      expect((await store.findById(a.id))?.totpSecretEnc).toBeNull();
    });

    it("accepts each TOTP step only once, in increasing order, even concurrently", async () => {
      const a = await account();
      expect(await store.acceptTotpStep(a.id, 100)).toBe(true);
      expect(await store.acceptTotpStep(a.id, 100)).toBe(false);
      expect(await store.acceptTotpStep(a.id, 99)).toBe(false);
      expect(await store.acceptTotpStep(a.id, 101)).toBe(true);
      const race = await Promise.all([store.acceptTotpStep(a.id, 200), store.acceptTotpStep(a.id, 200), store.acceptTotpStep(a.id, 200)]);
      expect(race.filter(Boolean)).toHaveLength(1);
      await store.setTotp(a.id, "new");
      expect((await store.findById(a.id))?.totpLastStep).toBeNull();
    });

    it("counts failures, locks, and clears", async () => {
      const a = await account();
      expect(await store.recordFailure(a.id)).toBe(1);
      expect(await store.recordFailure(a.id)).toBe(2);
      await store.lock(a.id, later(60_000));
      expect(await store.findById(a.id)).toMatchObject({ failedLogins: 0, lockedUntil: later(60_000) });
      await store.recordFailure(a.id);
      await store.clearFailures(a.id);
      expect(await store.findById(a.id)).toMatchObject({ failedLogins: 0, lockedUntil: null });
    });

    it("stores sessions by token hash together with their account", async () => {
      const a = await account();
      const s = await session(a.id, "hash-abc");
      expect(await store.findSession("hash-abc")).toMatchObject({ id: s.id, userId: a.id, csrfToken: "csrf", account: { email: "owner@example.test", role: "owner" } });
      expect(await store.findSession("other")).toBeNull();
      await store.touchSession(s.id, later(5000));
      expect((await store.findSession("hash-abc"))?.lastSeenAt).toEqual(later(5000));
      await store.deleteSession(s.id);
      expect(await store.findSession("hash-abc")).toBeNull();
    });

    it("purges expired sessions and revokes other sessions of a user", async () => {
      const a = await account();
      const keep = await session(a.id, "keep");
      await session(a.id, "drop-1");
      await session(a.id, "expired", later(-1000));
      expect(await store.purgeExpired(t0)).toBe(1);
      expect(await store.findSession("expired")).toBeNull();
      await store.deleteSessionsForUser(a.id, keep.id);
      expect(await store.findSession("keep")).not.toBeNull();
      expect(await store.findSession("drop-1")).toBeNull();
      await store.deleteSessionsForUser(a.id);
      expect(await store.findSession("keep")).toBeNull();
    });

    it("records audit entries", async () => {
      await store.audit({ actorEmail: "a@b.test", action: "login.success", entity: "admin", entityId: "1", detail: { ip: "1.2.3.4" }, at: t0 });
      await store.audit({ actorEmail: "a@b.test", action: "logout", entity: "admin", entityId: "1", at: t0 });
    });
  });
}

contract("in-memory", async () => {
  const store = new MemoryAdminStore();
  return { store, reset: async () => { store.accounts.clear(); store.sessions.clear(); }, close: async () => undefined };
});

contract("PostgreSQL (Prisma)", async () => {
  const testDb: TestDatabase = await createTestDatabase();
  return { store: new PrismaAdminStore(testDb.db), reset: () => testDb.reset(), close: () => testDb.close() };
});

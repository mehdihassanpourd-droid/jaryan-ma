/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config";
import { createRuntime, type Runtime } from "./runtime";

/**
 * Regression: with several pool connections the embedded development database (one PostgreSQL session) failed some
 * requests with Prisma P2039 ("failed to start a transaction"), i.e. random HTTP 500s. The trigger is what the admin does
 * constantly: a status change starts a background snapshot sync while the next page's reads arrive. This runs the REAL
 * server runtime on the embedded database and repeats exactly that, asserting that no request fails.
 */
const ORIGIN = "http://127.0.0.1:3001";
const PASSWORD = "rain-over-the-woven-hills-92";
let dir: string;
let runtime: Runtime;
let auth: Record<string, string>;
let logs: Array<{ event: string; detail?: Record<string, unknown> }>;

const call = async (method: string, path: string, body?: unknown) => {
  const res = await runtime.handle(new Request(`${ORIGIN}/api/v1${path}`, { method, headers: { ...auth, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "jm-embedded-"));
  logs = [];
  // Development-only configuration: a dev administrator without TOTP (refused in production) keeps the test self-contained.
  const config = loadConfig({ DEV_DATA_DIR: dir, DEV_ADMIN_EMAIL: "dev@example.test", DEV_ADMIN_PASSWORD: PASSWORD, SCHEDULER_ENABLED: "false", CUSTOMER_ACCOUNTS_ENABLED: "false", ADMIN_UI_ENABLED: "false", SCRYPT_LOG_N: "10", ADMIN_ORIGINS: ORIGIN });
  runtime = await createRuntime(config, (level, event, detail) => void logs.push({ event, detail: { level, ...detail } }));
  const login = await runtime.handle(new Request(`${ORIGIN}/api/v1/auth/login`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-test-ip": "1" }, body: JSON.stringify({ email: "dev@example.test", password: PASSWORD }) }));
  expect(login.status).toBe(200);
  const session = (await login.json()) as { csrfToken: string };
  auth = { origin: ORIGIN, cookie: (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "", "x-csrf-token": session.csrfToken };
}, 120_000);

afterAll(async () => {
  await runtime?.shutdown();
  await rm(dir, { recursive: true, force: true });
});

describe("embedded development database under concurrency", () => {
  it("never fails a request when status changes (background sync) race page-load reads", async () => {
    const category = await call("POST", "/categories", { name: "دسته", slug: "cat" });
    expect(category.status).toBe(201);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = await call("POST", "/products", { name: `محصول ${i}`, status: "draft", fulfillment: "unique", inventory: 1, categoryId: category.body.category.id, priceToman: 1000 + i, images: [] });
      expect(p.status).toBe(201);
      ids.push(p.body.product.id);
    }

    const failures: string[] = [];
    let total = 0;
    for (let round = 0; round < 25; round++) {
      const list = await call("GET", "/products?status=draft,published,archived&pageSize=100");
      const items = list.body.items as Array<{ id: string; version: number; status: string }>;
      const target = items[round % items.length]!;
      const tasks = [
        call("POST", `/products/${target.id}/status`, { status: target.status === "archived" ? "draft" : "archived", expectedVersion: target.version }),
        ...Array.from({ length: 6 }, () => call("GET", "/categories")),
        ...Array.from({ length: 6 }, () => call("GET", "/products?pageSize=20")),
        ...ids.slice(0, 3).map((id) => call("GET", `/products/${id}`)),
      ];
      for (const r of await Promise.all(tasks)) {
        total++;
        if (r.status >= 500) failures.push(String(r.status));
      }
    }
    expect(total).toBe(400);
    expect(failures).toEqual([]);
    expect(logs.filter((l) => l.event === "unhandled_error")).toEqual([]);
  }, 180_000);
});

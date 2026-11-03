import { describe, expect, it } from "vitest";
import { RateLimiter } from "./auth/rate-limit";
import { CLIENT_IP_HEADER } from "./api";
import { createCustomerApi } from "./customer-api";

/** /readyz only needs the clock, the limiter and `maintenance.runReadiness`; everything else is irrelevant here. */
function build(opts: { ok?: () => boolean; readyPerMinute?: number } = {}) {
  let now = new Date("2026-03-01T10:00:00.000Z");
  const state = { probes: 0, up: true };
  let release: (() => void) | null = null;
  const gate = { hold: false };
  const maintenance = {
    runReadiness: async () => {
      state.probes++;
      if (gate.hold) await new Promise<void>((resolve) => void (release = resolve));
      const ready = opts.ok ? opts.ok() : state.up;
      return { ready, checkedAt: new Date(now), checks: [{ name: "database", status: ready ? "ok" : "fail" }, { name: "migrations", status: ready ? "ok" : "fail" }] };
    },
  };
  const limiter = new RateLimiter(() => now.getTime());
  const api = createCustomerApi({ maintenance, limiter, clock: () => now, environment: "test", customerOrigins: "https://shop.test", shipping: {}, ...(opts.readyPerMinute ? { readyPerMinute: opts.readyPerMinute } : {}) } as never);
  const get = (ip = "198.51.100.5") => api(new Request("https://api.test/readyz", { headers: { [CLIENT_IP_HEADER]: ip } }));
  return { get, state, gate, advance: (ms: number) => void (now = new Date(now.getTime() + ms)), open: () => release?.() };
}

describe("/readyz protection", () => {
  it("answers a burst of requests from one probe", async () => {
    const t = build();
    const results = await Promise.all(Array.from({ length: 50 }, () => t.get()));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(t.state.probes).toBe(1);
    t.advance(2900);
    await t.get();
    expect(t.state.probes).toBe(1); // still inside the 3 s ready TTL
    t.advance(200);
    await t.get();
    expect(t.state.probes).toBe(2);
  });

  it("coalesces concurrent requests into the probe that is already running", async () => {
    const t = build();
    t.gate.hold = true;
    const pending = Array.from({ length: 20 }, () => t.get());
    await new Promise((r) => setTimeout(r, 5));
    expect(t.state.probes).toBe(1);
    t.open();
    expect((await Promise.all(pending)).map((r) => r.status)).toEqual(Array(20).fill(200));
  });

  it("does not keep a failure for long: a recovery shows within the 1 s failure TTL", async () => {
    const t = build();
    t.state.up = false;
    const down = await t.get();
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ ready: false, checks: [{ name: "database", status: "fail" }, { name: "migrations", status: "fail" }] });
    t.state.up = true;
    expect((await t.get()).status).toBe(503); // inside the failure TTL: one probe, not one per request
    expect(t.state.probes).toBe(1);
    t.advance(1100);
    expect((await t.get()).status).toBe(200); // recovered
    expect(t.state.probes).toBe(2);
  });

  it("a ready answer going bad is noticed within the 3 s ready TTL", async () => {
    const t = build();
    expect((await t.get()).status).toBe(200);
    t.state.up = false;
    t.advance(3100);
    expect((await t.get()).status).toBe(503);
  });

  it("throttles one client without affecting another, and reveals nothing but check names", async () => {
    const t = build({ readyPerMinute: 5 });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await t.get("203.0.113.9")).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429, 429, 429]);
    const limited = await t.get("203.0.113.9");
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    expect((await t.get("203.0.113.10")).status).toBe(200);
    t.advance(61_000);
    expect((await t.get("203.0.113.9")).status).toBe(200);
    const body = await (await t.get("203.0.113.10")).json();
    expect(Object.keys(body).sort()).toEqual(["checkedAt", "checks", "ready"]);
  });

  it("never lets a client cache the answer", async () => {
    expect((await build().get()).headers.get("cache-control")).toBe("no-store");
  });
});

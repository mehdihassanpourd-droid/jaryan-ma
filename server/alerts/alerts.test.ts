import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AlertManager, alertSinksFromEnv, assertWebhookUrl, ConsoleAlertSink, FileAlertSink, priorityForSeverity, WebhookAlertSink, type AlertSink, type DeliveredAlert } from "./alerts";

const recorder = (minPriority?: "P0" | "P1" | "P2" | "P3") => {
  const got: DeliveredAlert[] = [];
  const sink: AlertSink = { name: "rec", ...(minPriority ? { minPriority } : {}), deliver: async (a) => void got.push(a) };
  return { got, sink };
};
const alert = { priority: "P1" as const, key: "health.db", title: "پایگاه داده", message: "check failed" };

describe("AlertManager", () => {
  it("delivers to every sink, stamping state and time", async () => {
    const a = recorder(); const b = recorder();
    await new AlertManager([a.sink, b.sink], { now: () => new Date("2026-01-01T00:00:00Z") }).notify(alert);
    expect(a.got).toEqual([{ ...alert, state: "firing", at: "2026-01-01T00:00:00.000Z" }]);
    expect(b.got).toHaveLength(1);
  });

  it("routes by priority: a sink only gets alerts at least as urgent as its minimum", async () => {
    const all = recorder("P3"); const urgent = recorder("P1");
    const m = new AlertManager([all.sink, urgent.sink], { dedupeMs: 0 });
    await m.notify({ ...alert, key: "a", priority: "P3" });
    await m.notify({ ...alert, key: "b", priority: "P2" });
    await m.notify({ ...alert, key: "c", priority: "P0" });
    expect(all.got.map((x) => x.priority)).toEqual(["P3", "P2", "P0"]);
    expect(urgent.got.map((x) => x.priority)).toEqual(["P0"]);
  });

  it("suppresses repeats of the same key and state inside the window, then lets them through", async () => {
    const r = recorder(); let t = 0;
    const m = new AlertManager([r.sink], { dedupeMs: 60_000, now: () => new Date(t) });
    await m.notify(alert); await m.notify(alert);
    expect(r.got).toHaveLength(1);
    t = 61_000; await m.notify(alert);
    expect(r.got).toHaveLength(2);
  });

  it("sends 'resolved' once, only for something that fired", async () => {
    const r = recorder();
    const m = new AlertManager([r.sink]);
    await m.notify({ ...alert, state: "resolved" });
    expect(r.got).toHaveLength(0);
    await m.notify(alert); await m.notify({ ...alert, state: "resolved" });
    expect(r.got.map((x) => x.state)).toEqual(["firing", "resolved"]);
  });

  it("a failing sink neither throws nor blocks the others, and is reported", async () => {
    const r = recorder(); const failures: string[] = [];
    const bad: AlertSink = { name: "bad", deliver: async () => { throw new Error("boom"); } };
    await new AlertManager([bad, r.sink], { onSinkError: (n) => void failures.push(n) }).notify(alert);
    expect(r.got).toHaveLength(1);
    expect(failures).toEqual(["bad"]);
  });

  it("redacts secrets and personal data in text and fields before any sink sees them", async () => {
    const r = recorder();
    await new AlertManager([r.sink]).notify({ ...alert, message: "failed for 09121234567 at postgresql://u:pw@db/x", fields: { phone: "09121234567", count: 3 } });
    const text = JSON.stringify(r.got);
    expect(text).not.toMatch(/09121234567|pw@db/);
    expect(r.got[0]?.fields).toMatchObject({ phone: "[redacted]", count: 3 });
  });
});

describe("sinks", () => {
  it("console sink writes one JSON line", async () => {
    const lines: string[] = [];
    await new ConsoleAlertSink("P3", (l) => lines.push(l)).deliver({ ...alert, state: "firing", at: "t" });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ event: "alert", key: "health.db" });
  });

  it("file sink appends JSON lines and creates the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "alerts-"));
    try {
      const sink = new FileAlertSink(join(dir, "nested", "alerts.jsonl"));
      await sink.deliver({ ...alert, state: "firing", at: "1" });
      await sink.deliver({ ...alert, state: "resolved", at: "2" });
      const lines = (await readFile(join(dir, "nested", "alerts.jsonl"), "utf8")).trim().split("\n");
      expect(lines.map((l) => (JSON.parse(l) as { state: string }).state)).toEqual(["firing", "resolved"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("webhook sink posts JSON with a timeout and refuses redirects; non-2xx is an error", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const ok = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("", { status: 200 }); }) as unknown as typeof fetch;
    await new WebhookAlertSink("https://notify.example.ir/hook", "P1", ok).deliver({ ...alert, state: "firing", at: "t" });
    expect(calls[0]?.init).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ key: "health.db" });
    const bad = (async () => new Response("", { status: 500 })) as unknown as typeof fetch;
    await expect(new WebhookAlertSink("https://notify.example.ir/hook", "P1", bad).deliver({ ...alert, state: "firing", at: "t" })).rejects.toThrow("webhook_status_500");
  });

  it("webhook URLs must be https (private/loopback hosts may use http) and carry no credentials", () => {
    expect(() => assertWebhookUrl("https://notify.example.ir/h")).not.toThrow();
    expect(() => assertWebhookUrl("http://127.0.0.1:9000/h")).not.toThrow();
    expect(() => assertWebhookUrl("http://192.168.1.5/h")).not.toThrow();
    expect(() => assertWebhookUrl("http://notify.example.com/h")).toThrow("requires_https");
    expect(() => assertWebhookUrl("https://u:p@notify.example.com/h")).toThrow("credentials");
  });
});

describe("configuration", () => {
  it("defaults to the console sink only; nothing external unless configured", () => {
    expect(alertSinksFromEnv({}).map((s) => s.name)).toEqual(["console"]);
  });
  it("builds file and webhook sinks from the environment", () => {
    const sinks = alertSinksFromEnv({ ALERT_SINKS: "console, file,webhook", ALERT_FILE: "/tmp/a.jsonl", ALERT_WEBHOOK_URL: "https://notify.example.ir/h", ALERT_MIN_PRIORITY_WEBHOOK: "P0" });
    expect(sinks.map((s) => `${s.name}:${s.minPriority ?? "P3"}`)).toEqual(["console:P3", "file:P3", "webhook:P0"]);
  });
  it("rejects unknown sinks and a webhook without URL", () => {
    expect(() => alertSinksFromEnv({ ALERT_SINKS: "pager" })).toThrow("unknown alert sink");
    expect(() => alertSinksFromEnv({ ALERT_SINKS: "webhook" })).toThrow("ALERT_WEBHOOK_URL");
  });
  it("maps incident severity to priority", () => {
    expect([priorityForSeverity("critical"), priorityForSeverity("major"), priorityForSeverity("minor")]).toEqual(["P0", "P1", "P2"]);
  });
});

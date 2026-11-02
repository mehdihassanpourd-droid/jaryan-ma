import { describe, expect, it } from "vitest";
import { createLogger, describeError, observeRequests, REQUEST_ID_HEADER, redactLogValue, resolveRequestId } from "./logger";

const capture = () => {
  const lines: string[] = [];
  return { lines, log: createLogger({ write: (l) => lines.push(l), now: () => new Date("2026-01-01T00:00:00Z"), base: { service: "t" } }), parsed: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>) };
};

describe("structured logger", () => {
  it("writes one JSON line with time, level, event and the base fields", () => {
    const c = capture();
    c.log("info", "listening", { port: 3001 });
    expect(c.parsed()).toEqual([{ service: "t", port: 3001, time: "2026-01-01T00:00:00.000Z", level: "info", event: "listening" }]);
  });

  it("never lets detail overwrite time, level or event", () => {
    const c = capture();
    c.log("warn", "real", { level: "info", event: "fake", time: "x" });
    expect(c.parsed()[0]).toMatchObject({ level: "warn", event: "real", time: "2026-01-01T00:00:00.000Z" });
  });

  it("redacts values under sensitive keys and secrets inside strings, at any depth", () => {
    const c = capture();
    c.log("error", "x", {
      phone: "09121234567",
      otpCode: "123456",
      customer: { email: "ali@example.com", address: "تهران، خیابان ...", token: "abc" },
      note: "free text",
      detail: "failed for 09121234567 and ali@example.com using postgresql://u:pw@db.internal/shop Bearer abcdefghijkl",
      list: [{ password: "p" }],
      ok: 7,
    });
    const line = c.lines[0] ?? "";
    for (const secret of ["09121234567", "123456", "ali@example.com", "خیابان", "pw@db", "abcdefghijkl", "free text"]) expect(line).not.toContain(secret);
    expect(c.parsed()[0]).toMatchObject({ phone: "[redacted]", otpCode: "[redacted]", ok: 7 });
  });

  it("keeps the operational fields of a request line readable", () => {
    expect(redactLogValue({ requestId: "abcd1234", status: 200, path: "/health", errorMessage: "boom" })).toEqual({ requestId: "abcd1234", status: 200, path: "/health", errorMessage: "boom" });
  });

  it("bounds depth, array length and string length", () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redactLogValue(deep))).toContain("[truncated]");
    expect((redactLogValue(Array.from({ length: 100 }, (_, i) => i)) as unknown[]).length).toBe(25);
    expect((redactLogValue("ab cd ".repeat(1000)) as string).length).toBe(500);
  });

  it("describes errors without leaking their secrets", () => {
    const error = new Error("connect failed postgresql://user:hunter2@10.0.0.5/db for 09121234567");
    const d = describeError(error);
    expect(JSON.stringify(d)).not.toMatch(/hunter2|09121234567/);
    expect(d.errorName).toBe("Error");
    expect(describeError("plain 09121234567").errorMessage).not.toContain("09121234567");
  });
});

describe("request ids", () => {
  it("keeps a well-formed incoming id and replaces junk", () => {
    expect(resolveRequestId("abc12345-def", () => "gen")).toBe("abc12345-def");
    expect(resolveRequestId("x", () => "gen")).toBe("gen");
    expect(resolveRequestId("a b c d e f g h", () => "gen")).toBe("gen");
    expect(resolveRequestId("<script>alert(1)</script>", () => "gen")).toBe("gen");
    expect(resolveRequestId(null, () => "gen")).toBe("gen");
  });
});

describe("observeRequests", () => {
  const request = (path: string, headers: Record<string, string> = {}, method = "GET") => new Request(`https://api.test${path}`, { method, headers });

  it("adds the id to the response and logs method, path without query, status and duration only", async () => {
    const c = capture();
    let t = 1000;
    const handle = observeRequests(async () => new Response("{}", { status: 404 }), { log: c.log, now: () => (t += 5), generateId: () => "generated-id-1" });
    const res = await handle(request("/api/v1/customer/orders?token=SECRETVALUE&phone=09121234567", { cookie: "session=SECRETCOOKIE", authorization: "Bearer SECRETBEARER" }, "POST"));
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("generated-id-1");
    expect(c.parsed()).toEqual([expect.objectContaining({ event: "request", level: "warn", requestId: "generated-id-1", method: "POST", path: "/api/v1/customer/orders", status: 404, durationMs: 5 })]);
    expect(c.lines.join("")).not.toMatch(/SECRET|09121234567/);
  });

  it("reuses a valid incoming id only when the proxy is trusted; otherwise a client cannot choose the id in the logs", async () => {
    const c = capture();
    const trusted = observeRequests(async () => new Response("{}"), { log: c.log, trustIncomingId: true });
    expect((await trusted(request("/api/v1/x", { [REQUEST_ID_HEADER]: "from-proxy-0001" }))).headers.get(REQUEST_ID_HEADER)).toBe("from-proxy-0001");
    expect((await trusted(request("/api/v1/x", { [REQUEST_ID_HEADER]: "bad id with spaces" }))).headers.get(REQUEST_ID_HEADER)).not.toContain(" ");
    const untrusted = observeRequests(async () => new Response("{}"), { log: c.log, generateId: () => "server-made-id-1" });
    const res = await untrusted(request("/api/v1/x", { [REQUEST_ID_HEADER]: "client-chosen-01" }));
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("server-made-id-1");
    expect(c.lines.join("")).not.toContain("client-chosen-01");
  });

  it("keeps polled health endpoints quiet unless they fail", async () => {
    const c = capture();
    let status = 200;
    const handle = observeRequests(async () => new Response("{}", { status }), { log: c.log });
    await handle(request("/healthz"));
    await handle(request("/readyz"));
    expect(c.lines).toHaveLength(0);
    status = 503;
    await handle(request("/readyz"));
    expect(c.parsed()).toEqual([expect.objectContaining({ level: "error", path: "/readyz", status: 503 })]);
  });

  it("turns a thrown error into a redacted log line and a 500 that carries the request id", async () => {
    const c = capture();
    const handle = observeRequests(async () => { throw new Error("db down postgresql://u:pw@h/db 09121234567"); }, { log: c.log, generateId: () => "generated-id-2" });
    const res = await handle(request("/api/v1/customer/orders", {}, "POST"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error", requestId: "generated-id-2" });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("generated-id-2");
    expect(c.parsed()[0]).toMatchObject({ level: "error", event: "request_failed", requestId: "generated-id-2", status: 500, errorName: "Error" });
    expect(c.lines.join("")).not.toMatch(/pw@h|09121234567/);
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER } from "./api";
import { createNodeHandler, type AdapterOptions } from "./node-adapter";
import { LocalDiskStorage } from "./storage/local-disk";

let server: Server | undefined;
let dir: string | undefined;
afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function start(handle: (r: Request) => Promise<Response>, options: Partial<AdapterOptions> = {}) {
  server = createServer(createNodeHandler(handle, { trustProxy: false, maxBodyBytes: 1024, ...options }));
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("Node adapter", () => {
  it("passes method, path, query, headers and body, and returns status, headers and body", async () => {
    const base = await start(async (req) => {
      const body = await req.text();
      return new Response(JSON.stringify({ method: req.method, path: new URL(req.url).pathname + new URL(req.url).search, ct: req.headers.get("content-type"), body }), { status: 201, headers: { "x-test": "1" } });
    });
    const res = await fetch(`${base}/api/v1/x?q=1`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(res.headers.get("x-test")).toBe("1");
    expect(await res.json()).toEqual({ method: "POST", path: "/api/v1/x?q=1", ct: "application/json", body: '{"a":1}' });
  });

  it("emits several Set-Cookie headers separately", async () => {
    const base = await start(async () => {
      const h = new Headers();
      h.append("set-cookie", "a=1; Path=/");
      h.append("set-cookie", "b=2; Path=/");
      return new Response("ok", { headers: h });
    });
    expect((await fetch(base)).headers.getSetCookie()).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });

  it("uses the socket address and ignores a client-supplied client-IP header", async () => {
    const seen: string[] = [];
    const base = await start(async (req) => (seen.push(req.headers.get(CLIENT_IP_HEADER) ?? ""), new Response("ok")));
    await fetch(base, { headers: { [CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "7.7.7.7" } });
    expect(seen).toEqual(["127.0.0.1"]);
  });

  it("uses the last X-Forwarded-For entry only behind a trusted proxy", async () => {
    const seen: string[] = [];
    const base = await start(async (req) => (seen.push(req.headers.get(CLIENT_IP_HEADER) ?? ""), new Response("ok")), { trustProxy: true });
    await fetch(base, { headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.5" } });
    expect(seen).toEqual(["203.0.113.5"]);
  });

  it("rejects oversized bodies before and while reading", async () => {
    const base = await start(async () => new Response("ok"));
    const declared = await fetch(base, { method: "POST", body: "x".repeat(2000) });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "payload_too_large" });
  });

  it("turns handler crashes into a generic 500", async () => {
    const base = await start(async () => {
      throw new Error("postgres://user:secret@host/db");
    });
    const res = await fetch(base);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('{"error":"internal_error"}');
  });

  it("serves development media with safe headers, and nothing outside the media directory", async () => {
    dir = await mkdtemp(join(tmpdir(), "jm-media-"));
    const media = new LocalDiskStorage(dir);
    await media.put("images/p/a.webp", Uint8Array.from([1, 2, 3]), { contentType: "image/webp" });
    await media.put("secret.html", "<script>x</script>", { contentType: "text/html" });
    const base = await start(async () => new Response("api"), { media });
    const ok = await fetch(`${base}/media/images/p/a.webp`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await ok.arrayBuffer())).toEqual(Uint8Array.from([1, 2, 3]));
    expect((await fetch(`${base}/media/secret.html`)).status).toBe(404);
    expect((await fetch(`${base}/media/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect(await (await fetch(`${base}/other`)).text()).toBe("api");
  });
});

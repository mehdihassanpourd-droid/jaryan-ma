// In-memory FAKE of the ArvanCloud API for the automated tests. It mimics the shapes ASSUMED in lib/arvan.mjs; it proves the
// workflow logic (retry, expiry, clean-up, cost guard), NOT that ArvanCloud really behaves like this. The read-only dry-run
// against the real API is what verifies the shapes. No network except 127.0.0.1.
import { createServer } from "node:http";

export async function startMockArvan({ apiKey = "test-key-0123456789abcdef" } = {}) {
  const state = {
    regions: [{ code: "ir-test-1", name: "Test DC" }],
    store: { servers: [], "floating-ips": [], volumes: [], snapshots: [], "ssh-keys": [] },
    sizes: [{ id: "flv-1", name: "tiny", vcpus: 1, memory: 1, disk: 25 }, { id: "flv-2", name: "bigger", vcpus: 2, memory: 2, disk: 50 }],
    images: [{ id: "img-1", name: "Ubuntu 24.04", version: "24.04" }, { id: "img-2", name: "Debian 12" }],
    dns: [],
    calls: [],
    faults: { failNext: new Map(), permanentDelete: new Set(), failList: new Set(), noIp: false },
    nextId: 1,
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      const key = `${req.method} ${url.pathname}`;
      state.calls.push({ method: req.method, path: url.pathname, auth: req.headers.authorization, body });
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== `Apikey ${apiKey}`) return send(401, { message: "unauthorized" });
      const left = state.faults.failNext.get(key);
      if (left > 0) { state.faults.failNext.set(key, left - 1); return send(500, { message: "boom" }); }
      if (url.pathname === "/ecc/v1/regions") return send(200, { data: state.regions });
      let m = /^\/ecc\/v1\/regions\/([^/]+)\/([a-z-]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (m) {
        const [, , kind, id] = m;
        if (kind === "sizes" || kind === "images") return send(200, { data: state[kind] });
        const list = state.store[kind];
        if (!list) return send(404, {});
        if (req.method === "GET") return state.faults.failList.has(kind) ? send(500, { message: "list down" }) : send(200, { data: list });
        if (req.method === "POST") {
          const b = JSON.parse(body || "{}");
          const rec = { id: `${kind}-${state.nextId++}`, name: b.name, status: "ACTIVE", addresses: kind === "servers" && !state.faults.noIp ? { public: [{ addr: "203.0.113.10", version: 4 }] } : undefined, request: b };
          list.push(rec);
          return send(201, { data: rec, id: rec.id });
        }
        if (req.method === "DELETE") {
          if (state.faults.permanentDelete.has(kind)) return send(500, { message: "cannot delete" });
          const i = list.findIndex((x) => x.id === id);
          if (i < 0) return send(404, {});
          list.splice(i, 1);
          return send(200, {});
        }
      }
      m = /^\/cdn\/4\.0\/domains\/([^/]+)\/dns-records(?:\/([^/]+))?$/.exec(url.pathname);
      if (m) {
        if (req.method === "GET") return send(200, { data: state.dns });
        if (req.method === "POST") { const rec = { id: `dns-${state.nextId++}`, ...JSON.parse(body) }; state.dns.push(rec); return send(201, { data: rec }); }
        if (req.method === "DELETE") { state.dns = state.dns.filter((x) => x.id !== m[2]); return send(200, {}); }
      }
      send(404, { message: "unknown" });
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    state, apiKey, base: `http://127.0.0.1:${server.address().port}`,
    mutations: () => state.calls.filter((c) => c.method !== "GET"),
    add: (kind, name) => { const rec = { id: `${kind}-${state.nextId++}`, name }; state.store[kind].push(rec); return rec; },
    close: () => new Promise((r) => server.close(r)),
  };
}

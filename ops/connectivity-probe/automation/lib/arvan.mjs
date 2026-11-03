// ArvanCloud API client (plain fetch, no third-party code ever sees the key).
// UNVERIFIED: every path and body field below follows ArvanCloud's published IaaS API as far as it could be read from secondary
// sources; the official reference could not be opened from the build environment. They are all in ENDPOINTS/bodies of this ONE
// file, and the read-only "dry-run" action checks the response shapes before anything is created. Change them here only.
export const DEFAULT_BASE = "https://napi.arvancloud.ir";
export const ENDPOINTS = {
  regions: () => "/ecc/v1/regions",
  list: (region, kind) => `/ecc/v1/regions/${region}/${kind}`,
  create: (region, kind) => `/ecc/v1/regions/${region}/${kind}`,
  remove: (region, kind, id) => `/ecc/v1/regions/${region}/${kind}/${id}`,
  dnsRecords: (domain) => `/cdn/4.0/domains/${domain}/dns-records`,
};
export const KINDS = ["servers", "floating-ips", "volumes", "snapshots", "ssh-keys"]; // deletion order: servers first

export class ArvanError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

const isLocal = (u) => ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);

export function createClient({ apiKey, base = DEFAULT_BASE, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 4, timeoutMs = 20000 }) {
  if (!apiKey) throw new ArvanError("no API key");
  const url = new URL(base);
  if (url.protocol !== "https:" && !isLocal(url)) throw new ArvanError("refusing to send the API key over plain HTTP");
  const redact = (text) => String(text).split(apiKey).join("[redacted]");
  const log = { calls: [] };

  async function request(method, path, body) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(new URL(path, url), {
          method,
          headers: { Authorization: `Apikey ${apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
        log.calls.push({ method, path, status: res.status });
        const text = await res.text();
        if (res.ok) return text ? JSON.parse(text) : {};
        const retryable = res.status === 429 || res.status >= 500;
        lastError = new ArvanError(redact(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`), { status: res.status, retryable });
        if (!retryable) throw lastError;
      } catch (e) {
        if (e instanceof ArvanError && !e.retryable) throw e;
        lastError = e instanceof ArvanError ? e : new ArvanError(redact(`${method} ${path} failed: ${e.message}`), { retryable: true });
      }
      if (attempt < retries) await sleep(Math.min(30000, 500 * 2 ** attempt));
    }
    throw lastError;
  }

  const items = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : null);
  return {
    log,
    request,
    async regions() {
      const list = items(await request("GET", ENDPOINTS.regions()));
      if (!list) throw new ArvanError("unexpected shape of the regions answer");
      return list;
    },
    async list(region, kind) {
      const list = items(await request("GET", ENDPOINTS.list(region, kind)));
      if (!list) throw new ArvanError(`unexpected shape of the ${kind} answer`);
      return list;
    },
    create: (region, kind, body) => request("POST", ENDPOINTS.create(region, kind), body),
    remove: (region, kind, id) => request("DELETE", ENDPOINTS.remove(region, kind, id)),
    dnsList: async (domain) => items(await request("GET", ENDPOINTS.dnsRecords(domain))) ?? [],
    dnsCreate: (domain, record) => request("POST", ENDPOINTS.dnsRecords(domain), record),
    dnsRemove: (domain, id) => request("DELETE", `${ENDPOINTS.dnsRecords(domain)}/${id}`),
  };
}

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

// ArvanCloud's own documentation shows the Authorization header in several forms ("Apikey <key>", "APIKEY <key>", a bare key, ...),
// and a key pasted into a secret box often carries a trailing newline, quotes, or the word "Apikey" already. So the key is
// normalised first, and the header form is DETECTED with read-only requests instead of guessed.
export const SCHEMES = {
  Apikey: (k) => `Apikey ${k}`,
  bare: (k) => k,
  apikey: (k) => `apikey ${k}`,
  APIKEY: (k) => `APIKEY ${k}`,
  Bearer: (k) => `Bearer ${k}`,
};

/** Returns { key, notes } where notes says WHAT was cleaned (never the value). Throws a message that does not contain the value. */
export function normalizeKey(raw) {
  const notes = [];
  let key = String(raw ?? "");
  const trimmed = key.trim();
  if (trimmed !== key) notes.push("removed surrounding whitespace or a trailing newline");
  key = trimmed;
  const unquoted = key.replace(/^(["'`])(.*)\1$/s, "$2").trim();
  if (unquoted !== key) notes.push("removed surrounding quotes");
  key = unquoted;
  const prefix = /^(api[\s_-]?key|bearer)\s+/i.exec(key);
  if (prefix) {
    key = key.slice(prefix[0].length).trim();
    notes.push("removed a leading Apikey/Bearer word that was part of the pasted value");
  }
  if (!key) throw new ArvanError("the API key secret is empty after cleaning");
  if (/\s/.test(key)) throw new ArvanError("the API key secret contains spaces or line breaks inside it; paste only the key");
  if (/[^\x21-\x7e]/.test(key)) throw new ArvanError("the API key secret contains characters that are not allowed in an HTTP header");
  return { key, notes };
}

/** What kind of string the key is, without revealing it. */
export function keyShape(key) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
  return { length: key.length, uuidLike: uuid };
}

const isLocal = (u) => ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);

export function createClient({ apiKey: rawKey, base = DEFAULT_BASE, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 4, timeoutMs = 20000, scheme = "Apikey" }) {
  if (!rawKey) throw new ArvanError("no API key");
  const { key: apiKey, notes: keyNotes } = normalizeKey(rawKey);
  let currentScheme = scheme;
  const url = new URL(base);
  if (url.protocol !== "https:" && !isLocal(url)) throw new ArvanError("refusing to send the API key over plain HTTP");
  const redact = (text) => String(text).split(apiKey).join("[redacted]").split(String(rawKey).trim()).join("[redacted]");
  const log = { calls: [] };

  async function request(method, path, body) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetchImpl(new URL(path, url), {
          method,
          headers: { Authorization: SCHEMES[currentScheme](apiKey), Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
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

  /** One read-only GET with a given header form; returns only the HTTP status (never the headers or the key). */
  async function probe(name) {
    try {
      const res = await fetchImpl(new URL(ENDPOINTS.regions(), url), { method: "GET", headers: { Authorization: SCHEMES[name](apiKey), Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
      await res.text();
      return res.status;
    } catch {
      return 0;
    }
  }

  /** Finds the header form the server accepts using only GET /regions. Sticks to it for all later calls. */
  async function detectAuth() {
    const tried = [];
    for (const name of Object.keys(SCHEMES)) {
      const status = await probe(name);
      tried.push({ scheme: name, status });
      if (status >= 200 && status < 300) {
        currentScheme = name;
        return { ok: true, scheme: name, tried, keyNotes, shape: keyShape(apiKey) };
      }
      if (status === 403) { // the key IS recognised (authentication worked) but is not allowed to read this
        currentScheme = name;
        return { ok: false, scheme: name, tried, keyNotes, shape: keyShape(apiKey), diagnosis: "forbidden" };
      }
    }
    const network = tried.every((t) => t.status === 0);
    return { ok: false, tried, keyNotes, shape: keyShape(apiKey), diagnosis: network ? "unreachable" : "unauthorized" };
  }

  const items = (r) => (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : null);
  return {
    log,
    request,
    detectAuth,
    scheme: () => currentScheme,
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

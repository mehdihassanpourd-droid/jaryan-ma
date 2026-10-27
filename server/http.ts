export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export function errorResponse(code: string, status: number, extra: Record<string, unknown> = {}): Response {
  return json({ error: code, ...extra }, status);
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isMutating = (method: string) => MUTATING.has(method);

/** Development-only extensions of the Origin check (never set in production; the configuration refuses them there). */
export interface OriginPolicy {
  /**
   * Behind a TLS-terminating forwarder (GitHub Codespaces) that keeps the external host: an https Origin that is exactly the
   * host this request was addressed to, and whose host ends with one of these suffixes (e.g. `.app.github.dev`). That is the
   * definition of "same origin": a page on any other site, or on another Codespace, carries a different Origin than the host
   * it is calling, so it is still refused. It is not a wildcard.
   */
  sameHostSuffixes?: readonly string[];
  /**
   * Behind a forwarder that REWRITES Origin and Host to the upstream address before the request reaches this server (GitHub
   * Codespaces port forwarding does: the browser is on https://<codespace>-3001.app.github.dev, the server sees
   * `Origin: http://localhost:3001` and `Host: localhost:3001`). Accepts exactly the loopback origin of THIS server own
   * port, only when the request Host is that same address, and only when no Referer contradicts it. See `isRewrittenOrigin`.
   */
  rewrittenOriginPort?: number;
}

/**
 * CSRF defence for cookie-authenticated browsers (one layer; the API also requires the CSRF token): state-changing
 * requests must carry an `Origin` header that is on the allow-list. Fails closed when the allow-list is empty and no
 * development extension applies.
 */
export function originAllowed(request: Request, allowed: string | undefined, policy: OriginPolicy = {}): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const bare = origin.replace(/\/+$/, "");
  const list = (allowed ?? "").split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  if (list.includes(bare)) return true;
  if (policy.sameHostSuffixes && policy.sameHostSuffixes.length > 0 && isSameHostOrigin(request, bare, policy.sameHostSuffixes)) return true;
  return policy.rewrittenOriginPort !== undefined && isRewrittenOrigin(request, bare, policy.rewrittenOriginPort, list);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The forwarder destroyed the information that would tell this server who the browser really is, so an exact comparison
 * against the external origin cannot work. What can still be checked, and is:
 *  - the Origin is the loopback origin of THIS server (scheme http, localhost / 127.0.0.1 / [::1], this server port, nothing
 *    else): a page on another local port, a look-alike host or an https origin is refused;
 *  - the Host header says the same (a rebinding site has its own name in Host);
 *  - the Referer, when the browser sent one (cross-site requests send at least the origin by default), must be this
 *    Codespace own page: an allow-listed origin or the same loopback origin. A foreign Referer vetoes the request.
 * What it cannot do is stop a hostile page that also strips its Referer; the remaining layers cover that: the session cookie
 * is SameSite=Strict, signed-in changes need the CSRF token, the forwarded port itself sits behind GitHub login, and sign-in
 * needs password + TOTP. Anonymous endpoints cannot be abused cross-site (their responses are unreadable there, and finishing
 * needs the secret they return).
 */
function isRewrittenOrigin(request: Request, origin: string, port: number, allowList: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" || url.username || url.password || url.origin !== origin.toLowerCase()) return false;
  if (!LOOPBACK_HOSTS.has(url.hostname) || url.port !== String(port)) return false;
  if (!requestedHosts(request).includes(url.host)) return false;
  const referer = request.headers.get("referer");
  if (referer) {
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      return false;
    }
    if (refererOrigin !== url.origin && !allowList.includes(refererOrigin)) return false;
  }
  return true;
}

/** The host names this request was addressed to: the Host header and the first X-Forwarded-Host value (lower-case). */
export function requestedHosts(request: Request): string[] {
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host")?.split(",")[0]]
    .map((h) => h?.trim().toLowerCase())
    .filter((h): h is string => Boolean(h));
  try {
    hosts.push(new URL(request.url).host.toLowerCase());
  } catch {
    /* no usable URL */
  }
  return hosts;
}

const FORWARDED_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function isSameHostOrigin(request: Request, origin: string, suffixes: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // A bare https origin only: no credentials, no path, no explicit port, nothing but scheme + host.
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.origin !== origin.toLowerCase()) return false;
  const host = url.host;
  if (!FORWARDED_HOST.test(host)) return false;
  if (!suffixes.some((suffix) => host.length > suffix.length && host.endsWith(suffix.toLowerCase()))) return false;
  return requestedHosts(request).includes(host);
}

export class BodyError extends Error {
  constructor(public code: "payload_too_large" | "unsupported_media_type" | "invalid_json", public status: number) {
    super(code);
  }
}

/** Reads a JSON body with a hard size cap (checked on the header and on the actual bytes). */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) throw new BodyError("unsupported_media_type", 415);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new BodyError("payload_too_large", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BodyError("payload_too_large", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError("invalid_json", 400);
  }
}

export async function readBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new BodyError("payload_too_large", 413);
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new BodyError("payload_too_large", 413);
  return new Uint8Array(buffer);
}

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

/**
 * CSRF defence for cookie-authenticated browsers (one layer; the API also requires the CSRF token): state-changing
 * requests must carry an `Origin` header that is on the allow-list. Fails closed when
 * the allow-list is empty.
 *
 * `sameHostSuffixes` (development behind a TLS-terminating forwarder such as GitHub Codespaces, never production) adds
 * ONE more case: an https Origin that is exactly the host this request was addressed to, and whose host ends with one of
 * the listed suffixes (e.g. `.app.github.dev`). That is the definition of "same origin": a page on any other site, or on
 * another Codespace, carries a different Origin than the host it is calling, so it is still refused. It is not a
 * wildcard and never matches an origin the server is not itself being reached at.
 */
export function originAllowed(request: Request, allowed: string | undefined, sameHostSuffixes: readonly string[] = []): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const bare = origin.replace(/\/+$/, "");
  if (allowed && allowed.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean).includes(bare)) return true;
  return sameHostSuffixes.length > 0 && isSameHostOrigin(request, bare, sameHostSuffixes);
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

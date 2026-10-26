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
 */
export function originAllowed(request: Request, allowed: string | undefined): boolean {
  if (!allowed) return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return allowed.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean).includes(origin.replace(/\/+$/, ""));
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

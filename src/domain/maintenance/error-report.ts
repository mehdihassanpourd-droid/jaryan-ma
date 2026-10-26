import { z } from "zod";

/** Where an error came from. */
export const ERROR_SOURCES = ["server", "storefront", "admin"] as const;

const MAX_MESSAGE = 500;
const MAX_STACK = 4000;

export const clientErrorSchema = z
  .object({
    name: z.string().max(100).default("Error"),
    message: z.string().max(2000).default(""),
    stack: z.string().max(20_000).optional(),
    url: z.string().max(2000).optional(),
    release: z.string().max(64).optional(),
  })
  .strict();
export type ClientError = z.output<typeof clientErrorSchema>;

/**
 * Error text must never carry secrets or personal data into storage. These patterns are applied to
 * every message, stack and URL before an error report is saved or logged.
 */
const REDACTIONS: Array<[RegExp, string]> = [
  [/\b(?:postgres(?:ql)?|mysql|mongodb|redis|amqp|s3|https?):\/\/[^\s"'<>]*@[^\s"'<>]+/gi, "[url-with-credentials]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [token]"],
  [/\b(authorization|cookie|set-cookie|x-csrf-token|api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*[^\s,;"']+/gi, "$1=[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "[jwt]"],
  [/(?:\+98|0098|98|0)?9[0-9۰-۹]{9}\b/g, "[phone]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  [/\b[0-9a-f]{32,}\b/gi, "[hex]"],
  [/\b[A-Za-z0-9+/_-]{40,}={0,2}/g, "[long-token]"],
];

/** Only the credentials embedded in URLs (user:password@host). Safe for file paths and object keys. */
export function redactUrlCredentials(text: string): string {
  return text.replace(/\b([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]+@/gi, "$1://[credentials]@");
}

export function redactSensitive(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

/** Drops the query string and fragment (they can carry tokens or search terms) and any credentials. */
export function sanitizeUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

export interface SanitizedError {
  name: string;
  message: string;
  stack: string | null;
  url: string | null;
}

export function sanitizeError(input: { name?: string; message?: string; stack?: string; url?: string }): SanitizedError {
  const name = redactSensitive((input.name ?? "Error").replace(/[^\w.$ -]/g, "")).slice(0, 100) || "Error";
  return {
    name,
    message: redactSensitive(input.message ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE),
    stack: input.stack ? redactSensitive(input.stack).slice(0, MAX_STACK) : null,
    url: sanitizeUrl(input.url),
  };
}

/** Text used to group repeats of the same error: numbers and ids are blanked so "user 17" and "user 18" match. */
export function fingerprintInput(source: string, err: SanitizedError): string {
  const firstFrame = (err.stack?.split("\n").find((l) => /^\s*at\s/.test(l)) ?? "").replace(/:\d+:\d+\)?$/, "").replace(/\?[^\s)]*/, "").trim();
  const message = err.message.replace(/\b[0-9a-f]{8,}\b/gi, "#").replace(/\d+/g, "#");
  return [source, err.name, message, firstFrame].join("\n");
}

import { randomUUID } from "node:crypto";
import { redactSensitive } from "../../src/domain/maintenance/error-report";

/**
 * Structured logging: one JSON object per line on stdout (journald / `docker logs` / any file shipper reads it; nothing
 * leaves the machine). Every string is redacted before it is written, and values under sensitive KEY names are never
 * written at all. Request and response bodies, cookies and headers must not be passed in; this is the second line of
 * defence, not the first (CLAUDE.md rule 11).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;
export type Logger = (level: Exclude<LogLevel, "debug">, event: string, detail?: LogFields) => void;

/** Key names whose values are replaced entirely (phone numbers, codes, tokens, free text typed by people, addresses). */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|cookie|authorization|csrf|api[-_]?key|session|otp|code|phone|mobile|msisdn|e[-_]?mail|address|postal|name$|^body$|message(_?text)?$|^text$|note|national|iban|card|totp|credential/i;
/** Keys that look sensitive by the pattern above but are plain operational facts. */
const SAFE_KEYS = new Set(["event", "errorName", "errorMessage", "statusCode", "status", "requestId", "method", "path", "durationMs", "level", "time", "service", "check", "checks"]);

const MAX_STRING = 500;
const MAX_DEPTH = 5;
const MAX_KEYS = 40;
const MAX_ITEMS = 25;

export function redactLogValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSensitive(value).slice(0, MAX_STRING);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (value === undefined || typeof value === "function" || typeof value === "symbol") return undefined;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return describeError(value);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => redactLogValue(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, MAX_KEYS)
      .map(([key, v]) => [key, !SAFE_KEYS.has(key) && SENSITIVE_KEY.test(key) ? "[redacted]" : redactLogValue(v, depth + 1)]),
  );
}

/** An error as log fields: its class, a redacted one-line message and a short redacted stack. Never `cause` payloads. */
export function describeError(error: unknown): { errorName: string; errorMessage: string; stack?: string } {
  if (!(error instanceof Error)) return { errorName: "NonError", errorMessage: redactSensitive(String(error)).slice(0, 200) };
  return {
    errorName: error.name.replace(/[^\w.$-]/g, "").slice(0, 80) || "Error",
    errorMessage: redactSensitive(error.message).replace(/\s+/g, " ").trim().slice(0, 300),
    ...(error.stack ? { stack: redactSensitive(error.stack).split("\n").slice(0, 8).join("\n").slice(0, 1500) } : {}),
  };
}

export interface LoggerOptions {
  write?: (line: string) => void;
  now?: () => Date;
  /** Added to every line, e.g. { service: "jaryan-api" }. */
  base?: LogFields;
}

/** The logger every server module uses. Reserved keys (time, level, event) cannot be overwritten by `detail`. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? ((line: string) => console.log(line));
  const now = options.now ?? (() => new Date());
  return (level, event, detail) => {
    const safe = (redactLogValue({ ...options.base, ...detail }) ?? {}) as LogFields;
    write(JSON.stringify({ ...safe, time: now().toISOString(), level, event: redactSensitive(event).slice(0, 80) }));
  };
}

// ---- request IDs ----------------------------------------------------------------------------------------

export const REQUEST_ID_HEADER = "x-request-id";
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Reuses a well-formed id from a trusted proxy (so one id follows a request across nginx and the app); otherwise a fresh one. */
export function resolveRequestId(incoming: string | null | undefined, generate: () => string = randomUUID): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : generate();
}

export interface ObserveOptions {
  log: Logger;
  /** Paths that are polled constantly by monitors; logged only when they fail. */
  quietPaths?: readonly string[];
  now?: () => number;
  generateId?: () => string;
}

/**
 * Wraps the API handler: gives every request an id (response header `x-request-id`), writes one access line per request
 * (method, path WITHOUT query string, status, duration; never headers, cookies or bodies), and turns a thrown error into a
 * logged, redacted `internal_error` response that carries the id so support can find the log line.
 */
export function observeRequests(handle: (request: Request) => Promise<Response>, options: ObserveOptions): (request: Request) => Promise<Response> {
  const quiet = new Set(options.quietPaths ?? ["/healthz", "/readyz", "/health"]);
  const clock = options.now ?? Date.now;
  return async (request) => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER), options.generateId);
    const started = clock();
    let path = "/";
    try {
      path = new URL(request.url).pathname;
    } catch {
      /* keep "/" */
    }
    const base = { requestId, method: request.method, path };
    let response: Response;
    try {
      response = await handle(request);
    } catch (error) {
      options.log("error", "request_failed", { ...base, status: 500, durationMs: clock() - started, ...describeError(error) });
      return new Response(JSON.stringify({ error: "internal_error", requestId }), {
        status: 500,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", [REQUEST_ID_HEADER]: requestId },
      });
    }
    try {
      response.headers.set(REQUEST_ID_HEADER, requestId);
    } catch {
      /* immutable headers (a redirect built by fetch): skip */
    }
    const level = response.status >= 500 ? "error" : response.status >= 400 ? "warn" : "info";
    if (level !== "info" || !quiet.has(path)) options.log(level, "request", { ...base, status: response.status, durationMs: clock() - started });
    return response;
  };
}

import type { ValidationIssue } from "@/domain/product/schema";

/** Same-origin admin API (the page itself is served by the API server). The session cookie is HttpOnly; the CSRF token lives in memory only. */
export const API_BASE = "/api/v1";
export const CSRF_HEADER = "x-csrf-token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public issues: ValidationIssue[] = [],
    public retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

let csrfToken = "";
let onUnauthorized: () => void = () => undefined;

export const setCsrfToken = (token: string) => void (csrfToken = token);
export const setUnauthorizedHandler = (handler: () => void) => void (onUnauthorized = handler);

export interface RequestOptions {
  body?: unknown;
  /** Raw bytes (image upload); `contentType` is required with it. */
  raw?: Blob;
  contentType?: string;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
  /** Do not treat 401 as "session expired" (used by the login and session probes). */
  anonymous?: boolean;
}

function queryString(query: RequestOptions["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function api<T = unknown>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (method !== "GET" && csrfToken) headers[CSRF_HEADER] = csrfToken;
  let body: BodyInit | undefined;
  if (options.raw) {
    headers["content-type"] = options.contentType ?? "application/octet-stream";
    body = options.raw;
  } else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}${queryString(options.query)}`, { method, headers, body, signal: options.signal, credentials: "same-origin", cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "network_error");
  }

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    const info = (data ?? {}) as { error?: string; issues?: ValidationIssue[] };
    const retry = Number(response.headers.get("retry-after") ?? "") || undefined;
    if (response.status === 401 && !options.anonymous) onUnauthorized();
    throw new ApiError(response.status, info.error ?? `http_${response.status}`, info.issues ?? [], retry);
  }
  return data as T;
}

export const get = <T>(path: string, options?: RequestOptions) => api<T>("GET", path, options);
export const post = <T>(path: string, body?: unknown, options?: RequestOptions) => api<T>("POST", path, { ...options, body });
export const put = <T>(path: string, body?: unknown, options?: RequestOptions) => api<T>("PUT", path, { ...options, body });

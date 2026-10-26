import type { ZodType } from "zod";
import { AccountError } from "../customers/account-service";
import { CustomerAuthFailure } from "../customers/customer-auth";
import { DuplicateCustomerError } from "../customers/ports";
import { errorResponse, json, readJson } from "../http";
import { MaintenanceError } from "../maintenance/service";
import { SupportError } from "../support/service";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Reads and validates a JSON body. Validation problems list the field paths and codes only, never the values. */
export async function parseBody<T>(request: Request, schema: ZodType<T>, maxBytes = 64 * 1024): Promise<ParseResult<T>> {
  const parsed = schema.safeParse(await readJson(request, maxBytes));
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, response: errorResponse("validation_failed", 422, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.message })) }) };
}

export function parseQuery<T>(params: URLSearchParams, schema: ZodType<T>): ParseResult<T> {
  const raw: Record<string, string> = {};
  for (const [key, value] of params) if (value !== "") raw[key] = value;
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, response: errorResponse("invalid_query", 400, { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })) }) };
}

const limited = (code: string, retryAfterSeconds: number | undefined) =>
  json({ error: code, retryAfterSeconds: retryAfterSeconds ?? 60 }, 429, { "retry-after": String(retryAfterSeconds ?? 60) });

const SUPPORT_STATUS: Record<string, number> = {
  forbidden: 403, not_found: 404, too_many_open: 409, duplicate: 409, spam: 422, ticket_closed: 409, reopen_expired: 409,
  invalid_transition: 409, invalid_assignee: 422, account_suspended: 403, invalid_order: 422, validation: 422,
};
const ACCOUNT_STATUS: Record<string, number> = { not_found: 404, limit_reached: 409, open_orders: 409, not_pending_deletion: 409 };
const AUTH_STATUS: Record<string, number> = { invalid_code: 401, terms_required: 422, account_suspended: 403, sms_unavailable: 503 };
const MAINTENANCE_STATUS: Record<string, number> = { forbidden: 403, not_found: 404, invalid_transition: 409, validation: 422 };

/** Turns the known domain errors into HTTP responses; null for anything else (the caller treats it as a 500). */
export function domainErrorResponse(error: unknown): Response | null {
  if (error instanceof SupportError) return error.code === "rate_limited" ? limited(error.code, error.retryAfterSeconds) : errorResponse(error.code, SUPPORT_STATUS[error.code] ?? 400);
  if (error instanceof AccountError) return error.code === "rate_limited" ? limited(error.code, error.retryAfterSeconds) : errorResponse(error.code, ACCOUNT_STATUS[error.code] ?? 400);
  if (error instanceof CustomerAuthFailure) return error.code === "rate_limited" ? limited(error.code, error.retryAfterSeconds) : errorResponse(error.code, AUTH_STATUS[error.code] ?? 400);
  if (error instanceof MaintenanceError) return errorResponse(error.code, MAINTENANCE_STATUS[error.code] ?? 400);
  if (error instanceof DuplicateCustomerError) return errorResponse("email_in_use", 409);
  return null;
}

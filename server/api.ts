import { z } from "zod";
import { buildImageKey, MAX_IMAGE_BYTES, validateImageUpload } from "../src/domain/images";
import { ConflictError, NotFoundError, ValidationError } from "../src/domain/errors";
import { fixPersianLetters } from "../src/domain/persian";
import type { ObjectStorage } from "../src/domain/product/ports";
import { parseProductListQuery } from "../src/domain/product/query";
import {
  imageInputSchema,
  MAX_IMAGES_PER_PRODUCT,
  slugSchema,
  toValidationIssues,
  validateProductInput,
  type ImportProductInput,
} from "../src/domain/product/schema";
import { PRODUCT_STATUSES, type ProductStatus } from "../src/domain/product/types";
import { AuthFailure, type AuthService } from "./auth/auth-service";
import type { Authenticator, Principal } from "./auth/ports";
import { can, type Action } from "./auth/rbac";
import { clearedSessionCookie, safeEqual, sessionCookie, type CookieSettings } from "./auth/session";
import type { CatalogService } from "./catalog/service";
import type { SnapshotPublisher, SyncOptions, SyncTarget } from "./catalog/snapshot-publisher";
import { domainErrorResponse } from "./routes/common";
import { BodyError, errorResponse, isMutating, json, originAllowed, readBytes, readJson } from "./http";

export const CSRF_HEADER = "x-csrf-token";
/** Set by the Node adapter (never trusted from the client) so rate limiting sees the real address. */
export const CLIENT_IP_HEADER = "x-jm-client-ip";

/** What an admin route module receives: an authenticated, CSRF-checked, origin-checked request. */
export interface AdminRouteContext {
  request: Request;
  url: URL;
  method: string;
  /** Path below /api/v1, e.g. "/support/tickets/7". */
  path: string;
  principal: Principal;
}

/** Returns a response when it handles the route, or null to let the next module (or a 404) answer. */
export type AdminRouter = (ctx: AdminRouteContext) => Promise<Response | null>;

export interface ApiDeps {
  /** Additional authenticated route modules (support, FAQ, maintenance). */
  adminRoutes?: AdminRouter[];
  catalog: CatalogService;
  storage: ObjectStorage;
  publisher: SnapshotPublisher;
  auth: AuthService;
  authenticator: Authenticator;
  cookie: CookieSettings;
  sessionMaxAgeSeconds: number;
  /** Comma separated allow-list of origins for state-changing requests. Empty = all writes refused. */
  adminOrigins: string;
  importChunkMax: number;
  /** Runs work after the response is sent (snapshot publishing). Errors are logged, never thrown. */
  background: (task: Promise<unknown>) => void;
  uuid?: () => string;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

const PREFIX = "/api/v1";
const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const loginSchema = z.object({
  email: z.string().max(254),
  password: z.string().min(1).max(256),
  totp: z.string().max(12).optional(),
});
const passwordSchema = z.object({ current: z.string().min(1).max(256), next: z.string().min(1).max(256) });

const needsPublishRight = (status: ProductStatus) => status !== "draft";

export function createApi(deps: ApiDeps) {
  const log = deps.log ?? (() => undefined);
  const newId = deps.uuid ?? (() => crypto.randomUUID());

  const sync = (targets: SyncTarget[], options: SyncOptions = {}) =>
    deps.background(deps.publisher.sync(targets, options).catch((error) => log("snapshot_sync_failed", { error: error instanceof Error ? error.name : "unknown" })));

  async function login(request: Request): Promise<Response> {
    const body = loginSchema.safeParse(await readJson(request, MAX_JSON_BYTES));
    if (!body.success) return errorResponse("validation_failed", 422);
    try {
      const result = await deps.auth.login({
        ...body.data,
        ip: request.headers.get(CLIENT_IP_HEADER) ?? "unknown",
        userAgent: request.headers.get("user-agent"),
      });
      return json(
        { email: result.account.email, role: result.account.role, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() },
        200,
        { "set-cookie": sessionCookie(deps.cookie, result.token, deps.sessionMaxAgeSeconds) },
      );
    } catch (error) {
      if (!(error instanceof AuthFailure)) throw error;
      if (error.code === "too_many_attempts") {
        return json({ error: error.code }, 429, { "retry-after": String(error.retryAfterSeconds ?? 60) });
      }
      return errorResponse(error.code, error.code === "totp_not_enrolled" ? 403 : 401);
    }
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    if (url.pathname === "/healthz" && method === "GET") return json({ ok: true });
    if (!url.pathname.startsWith(`${PREFIX}/`)) return errorResponse("not_found", 404);
    const path = url.pathname.slice(PREFIX.length);

    try {
      if (isMutating(method) && !originAllowed(request, deps.adminOrigins)) return errorResponse("bad_origin", 403);
      if (path === "/auth/login" && method === "POST") return await login(request);

      const principal: Principal | null = await deps.authenticator.authenticate(request);
      if (!principal) return errorResponse("unauthorized", 401);
      if (isMutating(method) && !safeEqual(request.headers.get(CSRF_HEADER) ?? "", principal.csrfToken)) return errorResponse("bad_csrf_token", 403);
      const require = (action: Action) => (can(principal.role, action) ? null : errorResponse("forbidden", 403));
      const actor = principal.email;

      if (path === "/auth/session" && method === "GET") return json({ email: principal.email, role: principal.role, csrfToken: principal.csrfToken });
      if (path === "/auth/logout" && method === "POST") {
        await deps.auth.logout(principal);
        return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie(deps.cookie) });
      }
      if (path === "/auth/password" && method === "POST") {
        const body = passwordSchema.safeParse(await readJson(request, MAX_JSON_BYTES));
        if (!body.success) return errorResponse("validation_failed", 422);
        try {
          await deps.auth.changePassword(principal, body.data.current, body.data.next);
        } catch (error) {
          if (error instanceof AuthFailure) return errorResponse(error.code, error.code === "weak_password" ? 422 : 401, error.issues ? { issues: error.issues } : {});
          throw error;
        }
        return json({ ok: true });
      }

      for (const route of deps.adminRoutes ?? []) {
        const response = await route({ request, url, method, path, principal });
        if (response) return response;
      }

      if (path === "/categories") {
        if (method === "GET") return require("product:read") ?? json({ categories: await deps.catalog.repo.listCategories() });
        if (method === "POST") {
          const denied = require("category:write");
          if (denied) return denied;
          const body = await readJson(request, MAX_JSON_BYTES);
          const slug = isRecord(body) ? slugSchema.safeParse(body.slug) : null;
          const name = isRecord(body) && typeof body.name === "string" ? fixPersianLetters(body.name) : "";
          if (!slug?.success || name.length < 2 || name.length > 80) return errorResponse("validation_failed", 422);
          const parentId = isRecord(body) && typeof body.parentId === "string" ? body.parentId : null;
          const category = await deps.catalog.repo.createCategory({ slug: slug.data, name, parentId });
          deps.background(deps.publisher.resync().catch(() => undefined));
          return json({ category }, 201);
        }
      }

      if (path === "/products" && method === "GET") {
        const denied = require("product:read");
        if (denied) return denied;
        const query = parseProductListQuery(url.searchParams);
        if (!query.ok) return errorResponse("invalid_query", 400, { issues: query.issues });
        return json(await deps.catalog.list(query.value));
      }

      if (path === "/products" && method === "POST") {
        const denied = require("product:write");
        if (denied) return denied;
        const parsed = validateProductInput(await readJson(request, MAX_JSON_BYTES));
        if (!parsed.ok) return errorResponse("validation_failed", 422, { issues: parsed.issues });
        if (needsPublishRight(parsed.value.status) && require("product:publish")) return errorResponse("forbidden", 403);
        const product = await deps.catalog.create(parsed.value, actor);
        if (product.status === "published") sync([{ id: product.id }]);
        return json({ product }, 201);
      }

      if (path === "/products/import" && method === "POST") {
        const denied = require("product:import");
        if (denied) return denied;
        const body = await readJson(request, MAX_IMPORT_BYTES);
        const list = isRecord(body) && Array.isArray(body.products) ? body.products : null;
        if (!list || list.length === 0) return errorResponse("validation_failed", 422);
        if (list.length > deps.importChunkMax) return errorResponse("chunk_too_large", 413, { max: deps.importChunkMax });
        const products: ImportProductInput[] = [];
        const issues: Array<{ index: number; path: string; code: string }> = [];
        list.forEach((raw, index) => {
          const r = validateProductInput(raw);
          if (!r.ok) issues.push(...r.issues.map((i) => ({ index, ...i })));
          else if (!r.value.slug) issues.push({ index, path: "slug", code: "slug_required" });
          else {
            products.push({ ...r.value, slug: r.value.slug });
            if (needsPublishRight(r.value.status) && require("product:publish")) issues.push({ index, path: "status", code: "forbidden" });
          }
        });
        if (issues.length > 0) return errorResponse("validation_failed", 422, { issues });
        const outcome = await deps.catalog.importChunk(products, actor);
        // `?defer=1`: the client rebuilds category files once at the end with POST /catalog/resync.
        sync(outcome.affected.map((a) => ({ id: a.id, previousCategoryId: a.previousCategoryId })), { rebuildIndexes: url.searchParams.get("defer") !== "1" });
        return json({ created: outcome.created, updated: outcome.updated });
      }

      if (path === "/catalog/resync" && method === "POST") {
        const denied = require("catalog:sync");
        if (denied) return denied;
        const body = await readJson(request, MAX_JSON_BYTES);
        await deps.publisher.resync(isRecord(body) && typeof body.categoryId === "string" ? body.categoryId : undefined);
        return json({ ok: true });
      }

      const productMatch = /^\/products\/([A-Za-z0-9-]{1,64})(\/status|\/images)?$/.exec(path);
      if (productMatch) {
        const id = productMatch[1] as string;
        const sub = productMatch[2];

        if (!sub && method === "GET") {
          const denied = require("product:read");
          if (denied) return denied;
          const product = await deps.catalog.get(id);
          return product ? json({ product }) : errorResponse("not_found", 404);
        }

        if (!sub && method === "PUT") {
          const denied = require("product:write");
          if (denied) return denied;
          const body = await readJson(request, MAX_JSON_BYTES);
          if (!isRecord(body) || !Number.isInteger(body.expectedVersion)) return errorResponse("validation_failed", 422, { issues: [{ path: "expectedVersion", code: "required" }] });
          const parsed = validateProductInput(body.product);
          if (!parsed.ok) return errorResponse("validation_failed", 422, { issues: parsed.issues });
          const before = await deps.catalog.repo.getSummary(id);
          if (!before) return errorResponse("not_found", 404);
          if ((needsPublishRight(parsed.value.status) || before.status !== "draft") && require("product:publish")) return errorResponse("forbidden", 403);
          const product = await deps.catalog.update(id, parsed.value, body.expectedVersion as number, actor);
          sync([{ id, previousSlug: before.slug, previousCategoryId: before.categoryId }]);
          return json({ product });
        }

        if (sub === "/status" && method === "POST") {
          const denied = require("product:publish");
          if (denied) return denied;
          const body = await readJson(request, MAX_JSON_BYTES);
          if (!isRecord(body) || !Number.isInteger(body.expectedVersion) || !PRODUCT_STATUSES.includes(body.status as ProductStatus)) return errorResponse("validation_failed", 422);
          const before = await deps.catalog.repo.getSummary(id);
          if (!before) return errorResponse("not_found", 404);
          const product = await deps.catalog.setStatus(id, body.status as ProductStatus, body.expectedVersion as number, actor);
          sync([{ id, previousSlug: before.slug, previousCategoryId: before.categoryId }]);
          return json({ product });
        }

        if (sub === "/images" && method === "POST") {
          const denied = require("image:upload");
          if (denied) return denied;
          const bytes = await readBytes(request, MAX_IMAGE_BYTES);
          const check = validateImageUpload(bytes, request.headers.get("content-type"));
          if (!check.ok) return errorResponse(check.code === "too_large" ? "payload_too_large" : "invalid_image", check.code === "too_large" ? 413 : 415, { reason: check.code });
          const summary = await deps.catalog.repo.getSummary(id);
          if (!summary) return errorResponse("not_found", 404);
          const key = buildImageKey(id, newId(), check.extension);
          const alt = imageInputSchema.safeParse({ key, alt: url.searchParams.get("alt") ?? "" });
          if (!alt.success) return errorResponse("validation_failed", 422, { issues: toValidationIssues(alt.error) });
          await deps.storage.put(key, bytes, { contentType: check.type, cacheControl: "public, max-age=31536000, immutable" });
          const added = await deps.catalog.repo.addImage(id, key, alt.data.alt, MAX_IMAGES_PER_PRODUCT, actor);
          if (!added) {
            await deps.storage.delete([key]);
            return errorResponse("too_many_images", 409, { max: MAX_IMAGES_PER_PRODUCT });
          }
          if (summary.status === "published") sync([{ id }]);
          return json({ key, alt: alt.data.alt }, 201);
        }
      }

      return errorResponse("not_found", 404);
    } catch (error) {
      if (error instanceof BodyError) return errorResponse(error.code, error.status);
      if (error instanceof ValidationError) return errorResponse("validation_failed", 422, { issues: error.issues });
      if (error instanceof ConflictError) return errorResponse(error.code, 409);
      if (error instanceof NotFoundError) return errorResponse("not_found", 404);
      const known = domainErrorResponse(error);
      if (known) return known;
      log("unhandled_error", { error: error instanceof Error ? error.name : "unknown" });
      return errorResponse("internal_error", 500);
    }
  };
}

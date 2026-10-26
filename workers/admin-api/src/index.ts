import { fixPersianLetters } from "../../../src/domain/persian";
import { buildImageKey, validateImageUpload, MAX_IMAGE_BYTES } from "../../../src/domain/images";
import { parseProductListQuery } from "../../../src/domain/product/query";
import {
  MAX_IMAGES_PER_PRODUCT,
  imageInputSchema,
  slugSchema,
  toValidationIssues,
  validateProductInput,
  type ImportProductInput,
  type ProductInput,
} from "../../../src/domain/product/schema";
import { PRODUCT_STATUSES, type ProductStatus } from "../../../src/domain/product/types";
import { AuthError, createJwksFetcher, isValidTeamDomain, verifyAccessJwt, type Jwk } from "./auth/access";
import { can, type Action, type Role } from "./auth/rbac";
import type { Env } from "./env";
import { BodyError, errorResponse, isMutating, json, originAllowed, readBytes, readJson } from "./http";
import { resyncShards, syncCatalog, type SyncOptions, type SyncTarget } from "./publisher";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  addImageRow,
  createCategory,
  createProduct,
  defaultDeps,
  getAdmin,
  getProduct,
  getProductsByIds,
  importProducts,
  listCategories,
  listProducts,
  setProductStatus,
  updateProduct,
  type Deps,
} from "./repository";

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface Overrides {
  getKeys?: (refresh: boolean) => Promise<Jwk[]>;
  now?: () => number;
  deps?: Deps;
}

const PREFIX = "/api/v1";
const MAX_JSON_BYTES = 256 * 1024;
const MAX_IMPORT_BYTES = 768 * 1024;

const fetchers = new Map<string, (refresh: boolean) => Promise<Jwk[]>>();
function keyFetcher(teamDomain: string) {
  let f = fetchers.get(teamDomain);
  if (!f) {
    f = createJwksFetcher(teamDomain);
    fetchers.set(teamDomain, f);
  }
  return f;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

interface Principal {
  email: string;
  role: Role;
}

/** Fails closed: any missing configuration, token problem or unknown admin is a rejection. */
async function authenticate(request: Request, env: Env, overrides: Overrides): Promise<Principal | Response> {
  if (!isValidTeamDomain(env.ACCESS_TEAM_DOMAIN) || !env.ACCESS_AUD) return errorResponse("admin_not_configured", 503);
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return errorResponse("unauthorized", 401);
  try {
    const claims = await verifyAccessJwt(token, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      audience: env.ACCESS_AUD,
      getKeys: overrides.getKeys ?? keyFetcher(env.ACCESS_TEAM_DOMAIN),
      now: overrides.now,
    });
    const admin = await getAdmin(env.DB, claims.email);
    if (!admin) return errorResponse("forbidden", 403);
    return admin;
  } catch (error) {
    if (error instanceof AuthError && error.code === "keys_unavailable") return errorResponse("auth_unavailable", 503);
    return errorResponse("unauthorized", 401);
  }
}

function importChunkMax(env: Env): number {
  const n = Number.parseInt(env.IMPORT_CHUNK_MAX ?? "", 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 50) : 10;
}

function sync(env: Env, ctx: ExecutionContextLike, targets: SyncTarget[], options: SyncOptions = {}) {
  ctx.waitUntil(syncCatalog(env, targets, options).catch((error) => console.error("snapshot_sync_failed", error instanceof Error ? error.message : "unknown")));
}

const needsPublishRight = (status: ProductStatus) => status !== "draft";

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContextLike, overrides: Overrides = {}): Promise<Response> {
  const url = new URL(request.url);
  const deps = overrides.deps ?? defaultDeps;

  if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true });
  if (!url.pathname.startsWith(`${PREFIX}/`)) return errorResponse("not_found", 404);

  const principal = await authenticate(request, env, overrides);
  if (principal instanceof Response) return principal;
  if (isMutating(request.method) && !originAllowed(request, env.ADMIN_ORIGINS)) return errorResponse("bad_origin", 403);

  const require = (action: Action) => (can(principal.role, action) ? null : errorResponse("forbidden", 403));
  const path = url.pathname.slice(PREFIX.length);
  const method = request.method;

  try {
    if (path === "/me" && method === "GET") return json({ email: principal.email, role: principal.role });

    if (path === "/categories") {
      if (method === "GET") return require("product:read") ?? json({ categories: await listCategories(env.DB) });
      if (method === "POST") {
        const denied = require("category:write");
        if (denied) return denied;
        const body = await readJson(request, MAX_JSON_BYTES);
        const slug = isRecord(body) ? slugSchema.safeParse(body.slug) : null;
        const name = isRecord(body) && typeof body.name === "string" ? fixPersianLetters(body.name) : "";
        if (!slug?.success || name.length < 2 || name.length > 80) return errorResponse("validation_failed", 422);
        const parentId = isRecord(body) && typeof body.parentId === "string" ? body.parentId : null;
        const created = await createCategory(env.DB, { slug: slug.data, name, parentId }, deps);
        ctx.waitUntil(resyncShards(env).catch(() => undefined));
        return json({ category: created }, 201);
      }
    }

    if (path === "/products" && method === "GET") {
      const denied = require("product:read");
      if (denied) return denied;
      const query = parseProductListQuery(url.searchParams);
      if (!query.ok) return errorResponse("invalid_query", 400, { issues: query.issues });
      return json(await listProducts(env.DB, query.value));
    }

    if (path === "/products" && method === "POST") {
      const denied = require("product:write");
      if (denied) return denied;
      const parsed = validateProductInput(await readJson(request, MAX_JSON_BYTES));
      if (!parsed.ok) return errorResponse("validation_failed", 422, { issues: parsed.issues });
      if (needsPublishRight(parsed.value.status) && require("product:publish")) return errorResponse("forbidden", 403);
      const product = await createProduct(env.DB, parsed.value, principal.email, deps);
      if (product.status === "published") sync(env, ctx, [{ id: product.id }]);
      return json({ product }, 201);
    }

    if (path === "/products/import" && method === "POST") {
      const denied = require("product:import");
      if (denied) return denied;
      const body = await readJson(request, MAX_IMPORT_BYTES);
      const list = isRecord(body) && Array.isArray(body.products) ? body.products : null;
      if (!list || list.length === 0) return errorResponse("validation_failed", 422);
      const max = importChunkMax(env);
      if (list.length > max) return errorResponse("chunk_too_large", 413, { max });
      const products: ImportProductInput[] = [];
      const issues: Array<{ index: number; path: string; code: string }> = [];
      list.forEach((raw, index) => {
        const r = validateProductInput(raw);
        if (!r.ok) issues.push(...r.issues.map((i) => ({ index, ...i })));
        else if (!r.value.slug) issues.push({ index, path: "slug", code: "slug_required" });
        else products.push({ ...r.value, slug: r.value.slug });
        if (r.ok && needsPublishRight(r.value.status) && require("product:publish")) issues.push({ index, path: "status", code: "forbidden" });
      });
      if (issues.length > 0) return errorResponse("validation_failed", 422, { issues });
      const outcome = await importProducts(env.DB, products, principal.email, deps);
      // `?defer=1`: the client rebuilds shards once at the end with POST /catalog/resync.
      sync(env, ctx, outcome.affected.map((a) => ({ id: a.id, previousCategoryId: a.previousCategoryId })), { rebuildIndexes: url.searchParams.get("defer") !== "1" });
      return json({ created: outcome.created, updated: outcome.updated });
    }

    if (path === "/catalog/resync" && method === "POST") {
      const denied = require("catalog:sync");
      if (denied) return denied;
      const body = await readJson(request, MAX_JSON_BYTES);
      const categoryId = isRecord(body) && typeof body.categoryId === "string" ? body.categoryId : undefined;
      await resyncShards(env, categoryId);
      return json({ ok: true });
    }

    const productMatch = /^\/products\/([A-Za-z0-9-]{1,64})(\/status|\/images)?$/.exec(path);
    if (productMatch) {
      const id = productMatch[1] as string;
      const sub = productMatch[2];

      if (!sub && method === "GET") {
        const denied = require("product:read");
        if (denied) return denied;
        const product = await getProduct(env.DB, id);
        return product ? json({ product }) : errorResponse("not_found", 404);
      }

      if (!sub && method === "PUT") {
        const denied = require("product:write");
        if (denied) return denied;
        const body = await readJson(request, MAX_JSON_BYTES);
        if (!isRecord(body) || !Number.isInteger(body.expectedVersion)) return errorResponse("validation_failed", 422, { issues: [{ path: "expectedVersion", code: "required" }] });
        const parsed = validateProductInput(body.product);
        if (!parsed.ok) return errorResponse("validation_failed", 422, { issues: parsed.issues });
        const before = (await getProductsByIds(env.DB, [id]))[0];
        if (!before) return errorResponse("not_found", 404);
        if ((needsPublishRight(parsed.value.status) || before.status !== "draft") && require("product:publish")) return errorResponse("forbidden", 403);
        const product = await updateProduct(env.DB, id, parsed.value, body.expectedVersion as number, principal.email, deps);
        sync(env, ctx, [{ id, previousSlug: before.slug, previousCategoryId: before.categoryId }]);
        return json({ product });
      }

      if (sub === "/status" && method === "POST") {
        const denied = require("product:publish");
        if (denied) return denied;
        const body = await readJson(request, MAX_JSON_BYTES);
        if (!isRecord(body) || !Number.isInteger(body.expectedVersion) || !PRODUCT_STATUSES.includes(body.status as ProductStatus)) {
          return errorResponse("validation_failed", 422);
        }
        const before = (await getProductsByIds(env.DB, [id]))[0];
        if (!before) return errorResponse("not_found", 404);
        const product = await setProductStatus(env.DB, id, body.status as ProductStatus, body.expectedVersion as number, principal.email, deps);
        sync(env, ctx, [{ id, previousSlug: before.slug, previousCategoryId: before.categoryId }]);
        return json({ product });
      }

      if (sub === "/images" && method === "POST") {
        const denied = require("image:upload");
        if (denied) return denied;
        const bytes = await readBytes(request, MAX_IMAGE_BYTES);
        const check = validateImageUpload(bytes, request.headers.get("content-type"));
        if (!check.ok) return errorResponse(check.code === "too_large" ? "payload_too_large" : "invalid_image", check.code === "too_large" ? 413 : 415, { reason: check.code });
        const existing = await env.DB.prepare("SELECT status FROM products WHERE id = ?").bind(id).first<{ status: string }>();
        if (!existing) return errorResponse("not_found", 404);
        const key = buildImageKey(id, deps.uuid(), check.extension);
        const alt = imageInputSchema.safeParse({ key, alt: url.searchParams.get("alt") ?? "" });
        if (!alt.success) return errorResponse("validation_failed", 422, { issues: toValidationIssues(alt.error) });
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: check.type, cacheControl: "public, max-age=31536000, immutable" } });
        const added = await addImageRow(env.DB, id, key, alt.data.alt, MAX_IMAGES_PER_PRODUCT, principal.email, deps);
        if (!added) {
          await env.BUCKET.delete(key);
          return errorResponse("too_many_images", 409, { max: MAX_IMAGES_PER_PRODUCT });
        }
        if (existing.status === "published") sync(env, ctx, [{ id }]);
        return json({ key, alt: alt.data.alt }, 201);
      }
    }

    return errorResponse("not_found", 404);
  } catch (error) {
    if (error instanceof BodyError) return errorResponse(error.code, error.status);
    if (error instanceof ValidationError) return errorResponse("validation_failed", 422, { issues: error.issues });
    if (error instanceof ConflictError) return errorResponse(error.code, 409);
    if (error instanceof NotFoundError) return errorResponse("not_found", 404);
    console.error("unhandled_error", error instanceof Error ? error.name : "unknown");
    return errorResponse("internal_error", 500);
  }
}

const worker = {
  fetch(request: Request, env: Env, ctx: ExecutionContextLike): Promise<Response> {
    return handleRequest(request, env, ctx);
  },
};
export default worker;

export type { ProductInput };

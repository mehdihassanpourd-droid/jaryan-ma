import { z } from "zod";
import { addressInputSchema, otpRequestSchema, otpVerifySchema, profileUpdateSchema } from "../src/domain/customer/schema";
import { clientErrorSchema } from "../src/domain/maintenance/error-report";
import { publicHealth, type HealthReport } from "../src/domain/maintenance/health";
import { customerReplySchema, ticketCreateSchema } from "../src/domain/support/schema";
import { BodyError, errorResponse, isMutating, json, originAllowed } from "./http";
import { CLIENT_IP_HEADER, CSRF_HEADER } from "./api";
import type { RateLimiter } from "./auth/rate-limit";
import { clearedSessionCookie, safeEqual, sessionCookie, type CookieSettings } from "./auth/session";
import type { AccountService } from "./customers/account-service";
import type { CheckoutService } from "./customers/checkout-service";
import { OrderLifecycleError, customerCancelSchema, type OrderLifecycleService } from "./orders/order-lifecycle";
import { CheckoutError } from "./customers/checkout-service";
import { checkoutRequestSchema, quoteRequestSchema } from "../src/domain/customer/checkout";
import type { CustomerAuthService, CustomerSessionAuthenticator } from "./customers/customer-auth";
import type { CustomerRecord, CustomerPrincipal, CustomerStore } from "./customers/ports";
import type { MaintenanceService } from "./maintenance/service";
import { domainErrorResponse, parseBody, parseQuery } from "./routes/common";
import type { ShippingService } from "./shipping/service";
import type { SupportService } from "./support/service";

export interface CustomerApiDeps {
  /** When false every customer route answers 404: the feature is simply not there. */
  enabled: boolean;
  customers: CustomerStore;
  auth: CustomerAuthService;
  authenticator: CustomerSessionAuthenticator;
  accounts: AccountService;
  checkout: CheckoutService;
  /** Prices delivery (read-only) and turns carrier codes into tracking links when a provider knows them. */
  shipping: ShippingService;
  /** Lets a customer cancel their own PENDING order (stock goes back). */
  orderLifecycle: OrderLifecycleService;
  support: SupportService;
  maintenance: MaintenanceService;
  cookie: CookieSettings;
  sessionMaxAgeSeconds: number;
  /** Comma separated storefront origins allowed to call this API with credentials. Empty = browser calls refused. */
  customerOrigins: string;
  environment: string;
  limiter: RateLimiter;
  /** Cache for the public health status so the endpoint cannot be used to hammer the probes. */
  healthCacheMs?: number;
  clock?: () => Date;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

const PREFIX = "/api/v1/";

/** The order as the customer gets it: carrier codes become tracking links where a provider knows one (none do today). */
const presenter = (shipping: ShippingService) => <T extends { shipment: { carrier: Parameters<ShippingService["trackingUrl"]>[0]; trackingCode: string | null } | null } | null>(order: T): T =>
  order?.shipment ? { ...order, shipment: { ...order.shipment, trackingUrl: order.shipment.trackingCode ? shipping.trackingUrl(order.shipment.carrier, order.shipment.trackingCode) : null } } : order;
const pageSchema = z.object({ page: z.coerce.number().int().min(1).max(10_000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) });

function profileView(c: CustomerRecord) {
  return {
    phone: c.phone,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    marketingOptIn: c.marketingOptIn,
    status: c.status,
    termsVersion: c.termsVersion,
    createdAt: c.createdAt,
    deletionScheduledAt: c.deletionScheduledAt,
  };
}

/** True when the request path belongs to this module. */
export const isCustomerApiPath = (pathname: string) => pathname === "/health" || pathname.startsWith(`${PREFIX}customer/`) || pathname.startsWith(`${PREFIX}public/`);

/**
 * Customer-facing and public API (the admin API is separate, with its own cookie, origins and CSRF token).
 * Browsers on the storefront origin call it with credentials; everything else is refused.
 */
export function createCustomerApi(deps: CustomerApiDeps) {
  const log = deps.log ?? (() => undefined);
  const present = presenter(deps.shipping);
  const clock = deps.clock ?? (() => new Date());
  const allowedOrigins = deps.customerOrigins.split(",").map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  let healthCache: { at: number; report: HealthReport } | null = null;

  const corsFor = (request: Request, credentials: boolean): Record<string, string> => {
    const origin = request.headers.get("origin")?.replace(/\/+$/, "");
    if (!credentials) return { "access-control-allow-origin": "*", vary: "Origin" };
    if (!origin || !allowedOrigins.includes(origin)) return { vary: "Origin" };
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": `content-type,${CSRF_HEADER}`,
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  };

  const withHeaders = (response: Response, headers: Record<string, string>) => {
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  };

  const ip = (request: Request) => request.headers.get(CLIENT_IP_HEADER) ?? "unknown";

  async function publicRoutes(request: Request, url: URL): Promise<Response | null> {
    const method = request.method;
    if (url.pathname === "/health" && method === "GET") {
      const now = clock().getTime();
      if (!healthCache || now - healthCache.at > (deps.healthCacheMs ?? 30_000)) healthCache = { at: now, report: await deps.maintenance.runHealth() };
      const view = publicHealth(healthCache.report);
      return json(view, view.status === "down" ? 503 : 200);
    }
    if (url.pathname === `${PREFIX}public/faq` && method === "GET") {
      const response = json({ categories: await deps.support.publicFaq() }, 200, { "cache-control": "public, max-age=300" });
      return withHeaders(response, corsFor(request, false));
    }
    if (url.pathname === `${PREFIX}public/client-errors` && method === "POST") {
      // Credentialless and unauthenticated: strictly rate limited, size limited, sanitised before storage.
      const headers = corsFor(request, true);
      if (!headers["access-control-allow-origin"]) return errorResponse("bad_origin", 403);
      const limit = deps.limiter.hit(`client-error:${ip(request)}`, 30, 3600_000);
      if (!limit.allowed) return withHeaders(json({ error: "rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) }), headers);
      const body = await parseBody(request, clientErrorSchema, 24 * 1024);
      if (!body.ok) return withHeaders(body.response, headers);
      await deps.maintenance.reportError({ source: "storefront", environment: deps.environment, ...body.data });
      return withHeaders(new Response(null, { status: 204 }), headers);
    }
    return null;
  }

  async function customerRoutes(request: Request, url: URL, path: string, principalFor: () => Promise<CustomerPrincipal | null>): Promise<Response> {
    const method = request.method;

    // ---- sign-in (no session yet)
    if (path === "/auth/request-code" && method === "POST") {
      const body = await parseBody(request, otpRequestSchema);
      if (!body.ok) return body.response;
      const result = await deps.auth.requestCode(body.data.phone, ip(request));
      return json({ retryAfterSeconds: result.retryAfterSeconds }, 202);
    }
    if (path === "/auth/verify" && method === "POST") {
      const body = await parseBody(request, otpVerifySchema);
      if (!body.ok) return body.response;
      const result = await deps.auth.signIn({ phone: body.data.phone, code: body.data.code, acceptTerms: body.data.acceptTerms === true, ip: ip(request), userAgent: request.headers.get("user-agent") });
      return json(
        { customer: profileView(result.customer), csrfToken: result.csrfToken, isNewCustomer: result.isNewCustomer, pendingDeletion: result.pendingDeletion },
        200,
        { "set-cookie": sessionCookie(deps.cookie, result.token, deps.sessionMaxAgeSeconds) },
      );
    }

    // ---- everything below needs a session
    const principal = await principalFor();
    if (!principal) return errorResponse("unauthorized", 401);
    if (isMutating(method) && !safeEqual(request.headers.get(CSRF_HEADER) ?? "", principal.csrfToken)) return errorResponse("bad_csrf_token", 403);
    const id = principal.customerId;

    if (path === "/auth/logout" && method === "POST") {
      await deps.auth.signOut(principal);
      return json({ ok: true }, 200, { "set-cookie": clearedSessionCookie(deps.cookie) });
    }
    if (path === "/me" && method === "GET") {
      const customer = await deps.customers.findById(id);
      return customer ? json({ customer: profileView(customer), csrfToken: principal.csrfToken }) : errorResponse("unauthorized", 401);
    }
    if (path === "/me" && method === "PATCH") {
      const body = await parseBody(request, profileUpdateSchema);
      if (!body.ok) return body.response;
      return json({ customer: profileView(await deps.accounts.updateProfile(id, body.data)) });
    }

    // ---- addresses
    if (path === "/addresses" && method === "GET") return json({ addresses: await deps.accounts.listAddresses(id) });
    if (path === "/addresses" && method === "POST") {
      const body = await parseBody(request, addressInputSchema);
      if (!body.ok) return body.response;
      return json({ address: await deps.accounts.createAddress(id, body.data) }, 201);
    }
    const address = /^\/addresses\/([0-9a-f-]{36})(\/default)?$/.exec(path);
    if (address) {
      const addressId = address[1] as string;
      if (address[2] && method === "POST") {
        await deps.accounts.setDefaultAddress(id, addressId);
        return json({ ok: true });
      }
      if (!address[2] && method === "PUT") {
        const body = await parseBody(request, addressInputSchema);
        if (!body.ok) return body.response;
        return json({ address: await deps.accounts.updateAddress(id, addressId, body.data) });
      }
      if (!address[2] && method === "DELETE") {
        await deps.accounts.deleteAddress(id, addressId);
        return json({ ok: true });
      }
    }

    // ---- favourites
    if (path === "/favorites" && method === "GET") {
      const q = parseQuery(url.searchParams, pageSchema);
      if (!q.ok) return q.response;
      return json(await deps.accounts.listFavorites(id, q.data.page, q.data.pageSize));
    }
    const favorite = /^\/favorites\/([A-Za-z0-9%_-]{1,200})$/.exec(path);
    if (favorite) {
      let slug: string;
      try {
        slug = decodeURIComponent(favorite[1] as string);
      } catch {
        return errorResponse("not_found", 404);
      }
      if (method === "PUT") return json({ result: await deps.accounts.addFavorite(id, slug) });
      if (method === "DELETE") {
        await deps.accounts.removeFavorite(id, slug);
        return json({ ok: true });
      }
    }

    // ---- delivery prices for a cart (the checkout shows them before the customer orders)
    if (path === "/shipping/quote" && method === "POST") {
      const body = await parseBody(request, quoteRequestSchema);
      if (!body.ok) return body.response;
      try {
        return json(await deps.checkout.quote({ items: body.data.items, destination: body.data.destination }));
      } catch (error) {
        if (error instanceof CheckoutError) return errorResponse(error.code, error.code === "order_total_out_of_range" ? 422 : 409, error.problems.length > 0 ? { items: error.problems } : undefined);
        throw error;
      }
    }

    // ---- orders: place (pending, no payment) and read
    if (path === "/orders" && method === "POST") {
      const body = await parseBody(request, checkoutRequestSchema);
      if (!body.ok) return body.response;
      try {
        const placed = await deps.checkout.placeOrder(id, body.data);
        log("order_placed", { number: placed.order.number, created: placed.created, lines: placed.order.items.length });
        return json({ order: present(placed.order), created: placed.created }, placed.created ? 201 : 200);
      } catch (error) {
        if (error instanceof CheckoutError) {
          const status = error.code === "account_not_active" ? 403 : error.code === "order_total_out_of_range" ? 422 : 409;
          return errorResponse(error.code, status, { ...(error.problems.length > 0 ? { items: error.problems } : {}), ...(error.quotes.length > 0 ? { quotes: error.quotes } : {}) });
        }
        throw error;
      }
    }
    const cancel = /^\/orders\/(\d{1,10})\/cancel$/.exec(path);
    if (cancel && method === "POST") {
      const body = await parseBody(request, customerCancelSchema);
      if (!body.ok) return body.response;
      const number = Number(cancel[1]);
      try {
        await deps.orderLifecycle.transition({ number, to: "cancelled", by: "customer", customerId: id, reason: body.data.reason });
      } catch (error) {
        if (error instanceof OrderLifecycleError) return errorResponse(error.code, error.code === "not_found" ? 404 : 409, error.currentStatus ? { currentStatus: error.currentStatus } : {});
        throw error;
      }
      log("order_cancelled_by_customer", { number });
      return json({ order: present(await deps.accounts.getOrder(id, number)) });
    }
    if (path === "/orders" && method === "GET") {
      const q = parseQuery(url.searchParams, pageSchema);
      if (!q.ok) return q.response;
      {
        const page = await deps.accounts.listOrders(id, q.data.page, q.data.pageSize);
        return json({ ...page, items: page.items.map((o) => present(o)) });
      }
    }
    const order = /^\/orders\/(\d{1,10})$/.exec(path);
    if (order && method === "GET") return json({ order: present(await deps.accounts.getOrder(id, Number(order[1]))) });

    // ---- support
    if (path === "/support/tickets" && method === "GET") {
      const q = parseQuery(url.searchParams, pageSchema);
      if (!q.ok) return q.response;
      return json(await deps.support.listCustomerTickets(id, q.data.page, q.data.pageSize));
    }
    if (path === "/support/tickets" && method === "POST") {
      const body = await parseBody(request, ticketCreateSchema);
      if (!body.ok) return body.response;
      return json({ ticket: await deps.support.createTicket({ id }, body.data) }, 201);
    }
    const ticket = /^\/support\/tickets\/(\d{1,10})(\/reply)?$/.exec(path);
    if (ticket) {
      const number = Number(ticket[1]);
      if (!ticket[2] && method === "GET") return json({ ticket: await deps.support.getCustomerTicket(id, number) });
      if (ticket[2] && method === "POST") {
        const body = await parseBody(request, customerReplySchema);
        if (!body.ok) return body.response;
        return json({ ticket: await deps.support.customerReply({ id }, number, body.data.body) }, 201);
      }
    }

    // ---- data export and deletion
    if (path === "/account/export" && method === "POST") {
      const data = await deps.accounts.exportData(id);
      return json(data, 200, { "content-disposition": 'attachment; filename="jaryan-ma-my-data.json"' });
    }
    if (path === "/account/delete" && method === "POST") {
      const { scheduledAt } = await deps.accounts.requestDeletion(id, principal.sessionId);
      return json({ scheduledAt });
    }
    if (path === "/account/delete/cancel" && method === "POST") {
      await deps.accounts.cancelDeletion(id);
      return json({ ok: true });
    }
    return errorResponse("not_found", 404);
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    try {
      const pub = await publicRoutes(request, url);
      if (pub) return pub;

      if (!deps.enabled || !url.pathname.startsWith(`${PREFIX}customer/`)) return errorResponse("not_found", 404);
      const headers = corsFor(request, true);
      if (method === "OPTIONS") return new Response(null, { status: headers["access-control-allow-origin"] ? 204 : 403, headers });
      // Writes must come from the storefront origin (CSRF defence layer 1; the CSRF token is layer 2).
      if (isMutating(method) && !originAllowed(request, deps.customerOrigins)) return errorResponse("bad_origin", 403);
      if (!isMutating(method) && request.headers.get("origin") && !headers["access-control-allow-origin"]) return errorResponse("bad_origin", 403);

      const path = url.pathname.slice(`${PREFIX}customer`.length);
      const response = await customerRoutes(request, url, path, () => deps.authenticator.authenticate(request));
      return withHeaders(response, headers);
    } catch (error) {
      const headers = corsFor(request, true);
      if (error instanceof BodyError) return withHeaders(errorResponse(error.code, error.status), headers);
      const known = domainErrorResponse(error);
      if (known) return withHeaders(known, headers);
      log("unhandled_error", { error: error instanceof Error ? error.name : "unknown", scope: "customer" });
      return withHeaders(errorResponse("internal_error", 500), headers);
    }
  };
}

import type { AdminRouter } from "../api";
import { can } from "../auth/rbac";
import { errorResponse, json } from "../http";
import { adminOrderListQuery, type OrderAdminService } from "../orders/order-admin";
import { OrderLifecycleError, shipmentInputSchema, staffTransitionSchema, type OrderLifecycleService } from "../orders/order-lifecycle";
import { parseBody, parseQuery } from "./common";

const ORDER_PATH = /^\/orders\/(\d{1,10})(\/transition|\/shipment)?$/;

/** Staff-facing order endpoints. They show customers' names, phones and addresses (`order:read`) and change orders (`order:manage`). */
export function createOrderAdminRoutes(orders: OrderAdminService, lifecycle: OrderLifecycleService): AdminRouter {
  return async ({ request, url, method, path, principal }) => {
    const match = ORDER_PATH.exec(path);
    if (path !== "/orders" && path !== "/orders/summary" && !match) return null;

    if (match?.[2] === "/shipment") {
      if (method !== "PUT") return errorResponse("method_not_allowed", 405);
      if (!can(principal.role, "order:manage")) return errorResponse("forbidden", 403);
      const body = await parseBody(request, shipmentInputSchema);
      if (!body.ok) return body.response;
      try {
        await lifecycle.setShipment(Number(match[1]), body.data, principal.email);
      } catch (error) {
        if (error instanceof OrderLifecycleError) return errorResponse(error.code, error.code === "not_found" ? 404 : 409, error.currentStatus ? { currentStatus: error.currentStatus } : {});
        throw error;
      }
      const order = await orders.get(Number(match[1]));
      return order ? json({ order }) : errorResponse("not_found", 404);
    }

    if (match?.[2]) {
      if (method !== "POST") return errorResponse("method_not_allowed", 405);
      if (!can(principal.role, "order:manage")) return errorResponse("forbidden", 403);
      const body = await parseBody(request, staffTransitionSchema);
      if (!body.ok) return body.response;
      const number = Number(match[1]);
      try {
        await lifecycle.transition({ number, to: body.data.to, by: "staff", expectedStatus: body.data.expectedStatus, actorLabel: principal.email, reason: body.data.reason, ...(body.data.shipment ? { shipment: body.data.shipment } : {}) });
      } catch (error) {
        if (error instanceof OrderLifecycleError) {
          return errorResponse(error.code, error.code === "not_found" ? 404 : 409, error.currentStatus ? { currentStatus: error.currentStatus } : {});
        }
        throw error;
      }
      const order = await orders.get(number);
      return order ? json({ order }) : errorResponse("not_found", 404);
    }

    if (!can(principal.role, "order:read")) return errorResponse("forbidden", 403);
    if (method !== "GET") return errorResponse("method_not_allowed", 405);
    if (path === "/orders/summary") return json(await lifecycle.pendingSummary());
    if (path === "/orders") {
      const query = parseQuery(url.searchParams, adminOrderListQuery);
      if (!query.ok) return query.response;
      return json(await orders.list(query.data));
    }
    const order = await orders.get(Number(path.slice("/orders/".length)));
    return order ? json({ order }) : errorResponse("not_found", 404);
  };
}

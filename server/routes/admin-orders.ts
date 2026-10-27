import type { AdminRouter } from "../api";
import { can } from "../auth/rbac";
import { errorResponse, json } from "../http";
import { adminOrderListQuery, type OrderAdminService } from "../orders/order-admin";
import { parseQuery } from "./common";

/** Staff-facing, read-only order endpoints. They show customers' names, phones and addresses, so they need `order:read`. */
export function createOrderAdminRoutes(orders: OrderAdminService): AdminRouter {
  return async ({ url, method, path, principal }) => {
    if (path !== "/orders" && !/^\/orders\/\d{1,10}$/.test(path)) return null;
    if (!can(principal.role, "order:read")) return errorResponse("forbidden", 403);
    if (method !== "GET") return errorResponse("method_not_allowed", 405);
    if (path === "/orders") {
      const query = parseQuery(url.searchParams, adminOrderListQuery);
      if (!query.ok) return query.response;
      return json(await orders.list(query.data));
    }
    const order = await orders.get(Number(path.slice("/orders/".length)));
    return order ? json({ order }) : errorResponse("not_found", 404);
  };
}

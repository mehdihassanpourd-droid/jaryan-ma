import type { AdminRouter } from "../api";
import { can } from "../auth/rbac";
import { shippingConfigSchema } from "../../src/domain/shipping/config";
import { errorResponse, json } from "../http";
import { ShippingConfigConflictError, type ShippingConfigStore } from "../shipping/config-store";
import { parseBody } from "./common";

/** The owner's shipping table: methods, prices by destination and weight, free-shipping thresholds, default item weight. */
export function createShippingAdminRoutes(config: ShippingConfigStore, clock: () => Date = () => new Date()): AdminRouter {
  return async ({ request, method, path, principal }) => {
    if (path !== "/shipping/config") return null;
    if (method === "GET") {
      if (!can(principal.role, "shipping:read")) return errorResponse("forbidden", 403);
      return json({ config: await config.load() });
    }
    if (method === "PUT") {
      if (!can(principal.role, "shipping:manage")) return errorResponse("forbidden", 403);
      const body = await parseBody(request, shippingConfigSchema);
      if (!body.ok) return body.response;
      try {
        return json({ config: await config.save(body.data, principal.email, clock()) });
      } catch (error) {
        // Someone saved a newer table since this screen loaded: send the current one so nothing is silently overwritten.
        if (error instanceof ShippingConfigConflictError) return errorResponse("shipping_config_changed", 409, { detail: { config: await config.load() } });
        throw error;
      }
    }
    return errorResponse("method_not_allowed", 405);
  };
}

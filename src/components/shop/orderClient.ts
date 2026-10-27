import { createOrderApi } from "@/lib/order-api";
import { ORDER_API_BASE } from "@/lib/order-config";

/** One client for the whole page (it holds the CSRF token in memory). Null when this build has no order system. */
export const orderApi = ORDER_API_BASE ? createOrderApi(ORDER_API_BASE) : null;

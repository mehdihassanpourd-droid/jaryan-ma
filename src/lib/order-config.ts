import { orderApiBase } from "@/lib/order-api";

/** Inlined at build time: the public base URL of the customer API. Null = this build has no order system (checkout is a labelled demo). */
export const ORDER_API_BASE = orderApiBase(process.env.NEXT_PUBLIC_ORDER_API_URL);

import type { CheckoutRequest, LineProblem } from "@/domain/customer/checkout";
import { ORDER_STATUS_LABEL as STATUS_LABEL, type OrderActorType, type OrderStatusValue } from "@/domain/customer/order-status";

/**
 * Browser client of the customer API (sign-in with a one-time code, addresses, orders). The API lives on the shop's own
 * domain family (the session cookie is SameSite=Strict, see docs/customers/CUSTOMERS.md); the storefront only knows its
 * public base URL (`NEXT_PUBLIC_ORDER_API_URL`). Without it the store has NO order system and checkout is a labelled demo.
 */
export function orderApiBase(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return null;
  if (url.username || url.password) return null;
  return value.replace(/\/+$/, "");
}

export class OrderApiError extends Error {
  constructor(
    /** HTTP status; 0 = the server could not be reached. */
    public status: number,
    public code: string,
    public detail: { items?: LineProblem[]; retryAfterSeconds?: number; issues?: Array<{ path: string; code: string }> } = {},
  ) {
    super(code);
    this.name = "OrderApiError";
  }
}

export interface CustomerProfile {
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string;
}

export interface ApiOrderEvent {
  status: OrderStatusValue;
  at: string;
  /** The reason staff gave when rejecting or cancelling. */
  reason: string | null;
  by: OrderActorType;
}

export interface ApiOrder {
  number: number;
  status: OrderStatusValue;
  totalToman: number;
  placedAt: string;
  customerNote: string | null;
  shipping: { recipientName: string | null; recipientPhone: string | null; province: string; city: string; street: string | null; plaque: string | null; unit: string | null; postalCode: string | null };
  items: Array<{ title: string; sku: string | null; variant: Record<string, string> | null; imageKey: string | null; unitPriceToman: number; quantity: number }>;
  /** Oldest first. */
  history: ApiOrderEvent[];
}

export interface ApiAddress {
  id: string;
  recipientName: string;
  recipientPhone: string;
  province: string;
  city: string;
  street: string;
  plaque: string | null;
  unit: string | null;
  postalCode: string;
  isDefault: boolean;
}

export const ORDER_STATUS_LABEL = STATUS_LABEL;

export function createOrderApi(baseUrl: string, fetchImpl: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, "");
  /** Kept in memory only (never in web storage): `GET /me` hands it out again after a reload while the cookie lives. */
  let csrf: string | null = null;

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (method !== "GET" && csrf) headers["x-csrf-token"] = csrf;
    let response: Response;
    try {
      response = await fetchImpl(`${base}/api/v1/customer${path}`, { method, headers, credentials: "include", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch {
      throw new OrderApiError(0, "network");
    }
    let data: Record<string, unknown> | null = null;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      /* no body */
    }
    if (!response.ok) {
      throw new OrderApiError(response.status, typeof data?.error === "string" ? data.error : `http_${response.status}`, {
        ...(Array.isArray(data?.items) ? { items: data.items as LineProblem[] } : {}),
        ...(typeof data?.retryAfterSeconds === "number" ? { retryAfterSeconds: data.retryAfterSeconds } : {}),
        ...(Array.isArray(data?.issues) ? { issues: data.issues as Array<{ path: string; code: string }> } : {}),
      });
    }
    return data as T;
  }

  return {
    /** The signed-in customer, or null when there is no (valid) session. */
    async me(): Promise<CustomerProfile | null> {
      try {
        const r = await request<{ customer: CustomerProfile; csrfToken: string }>("GET", "/me");
        csrf = r.csrfToken;
        return r.customer;
      } catch (error) {
        if (error instanceof OrderApiError && error.status === 401) {
          csrf = null;
          return null;
        }
        throw error;
      }
    },
    requestCode: (phone: string) => request<{ retryAfterSeconds: number }>("POST", "/auth/request-code", { phone }),
    async verify(phone: string, code: string, acceptTerms: boolean): Promise<CustomerProfile> {
      const r = await request<{ customer: CustomerProfile; csrfToken: string }>("POST", "/auth/verify", { phone, code, ...(acceptTerms ? { acceptTerms: true } : {}) });
      csrf = r.csrfToken;
      return r.customer;
    },
    async logout(): Promise<void> {
      await request("POST", "/auth/logout");
      csrf = null;
    },
    addresses: async () => (await request<{ addresses: ApiAddress[] }>("GET", "/addresses")).addresses,
    createAddress: (address: Record<string, unknown>) => request("POST", "/addresses", address),
    placeOrder: (order: CheckoutRequest) => request<{ order: ApiOrder; created: boolean }>("POST", "/orders", order),
    listOrders: (page = 1) => request<{ items: ApiOrder[]; total: number }>("GET", `/orders?page=${page}&pageSize=20`),
    getOrder: async (number: number) => (await request<{ order: ApiOrder }>("GET", `/orders/${number}`)).order,
    /** The customer cancels their own PENDING order (its reserved stock goes back). */
    cancelOrder: async (number: number) => (await request<{ order: ApiOrder }>("POST", `/orders/${number}/cancel`, {})).order,
  };
}
export type OrderApi = ReturnType<typeof createOrderApi>;

import type { ShippingSnapshot } from "./schema";

export const ORDER_STATUSES = ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/** An order as staff see it (read-only), over JSON: dates are ISO strings, amounts are exact whole Toman. */
export interface AdminOrderJson {
  number: number;
  status: OrderStatusValue;
  totalToman: number;
  placedAt: string;
  customerNote: string | null;
  shipping: ShippingSnapshot;
  /** Who placed it (null once the customer has been anonymised). */
  customer: { phone: string | null; name: string | null };
  items: Array<{ title: string; sku: string | null; variant: Record<string, string> | null; imageKey: string | null; unitPriceToman: number; quantity: number }>;
}

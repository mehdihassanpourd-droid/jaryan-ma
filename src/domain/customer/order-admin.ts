import type { OrderActorType, OrderStatusValue } from "./order-status";
import type { ShippingSnapshot } from "./schema";

export { ORDER_STATUSES, type OrderStatusValue } from "./order-status";

/** One entry of an order's history as staff see it. */
export interface AdminOrderEvent {
  from: OrderStatusValue | null;
  to: OrderStatusValue;
  actor: OrderActorType;
  /** The staff member's e-mail (staff actions only). */
  actorLabel: string | null;
  reason: string | null;
  at: string;
}

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
  items: Array<{ title: string; sku: string | null; variant: Record<string, string> | null; imageKey: string | null; unitPriceToman: number; quantity: number; reservedQuantity: number }>;
  /** Oldest first. */
  history: AdminOrderEvent[];
}

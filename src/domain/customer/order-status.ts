/**
 * The life of an order, as a small state machine shared by the server (which enforces it), the admin app and the storefront
 * (which only decide which buttons to show: the server stays authoritative).
 *
 *   pending ──confirm──▶ confirmed ──▶ preparing ──▶ shipped ──▶ delivered
 *      │ reject (staff)      │ cancel (staff)  │ cancel (staff)
 *      │ cancel (customer or staff)
 *      ▼                     ▼
 *   rejected / cancelled (final; stock reserved by the order is given back exactly once)
 *
 * Stock is reserved when the order is placed (it leaves the product's `inventory`) and returned only when an order ends as
 * `rejected` or `cancelled`. Once shipped an order can no longer be cancelled here (returns are a later feature).
 */
export const ORDER_STATUSES = ["pending", "confirmed", "preparing", "shipped", "delivered", "cancelled", "rejected"] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

export type OrderActorType = "customer" | "staff" | "system";

const TRANSITIONS: Record<OrderStatusValue, ReadonlyArray<{ to: OrderStatusValue; by: readonly OrderActorType[] }>> = {
  pending: [
    { to: "confirmed", by: ["staff"] },
    { to: "rejected", by: ["staff"] },
    { to: "cancelled", by: ["customer", "staff"] },
  ],
  confirmed: [
    { to: "preparing", by: ["staff"] },
    { to: "cancelled", by: ["staff"] },
  ],
  preparing: [
    { to: "shipped", by: ["staff"] },
    { to: "cancelled", by: ["staff"] },
  ],
  shipped: [{ to: "delivered", by: ["staff"] }],
  delivered: [],
  cancelled: [],
  rejected: [],
};

export const canTransition = (from: OrderStatusValue, to: OrderStatusValue, by: OrderActorType): boolean =>
  TRANSITIONS[from].some((t) => t.to === to && t.by.includes(by));

/** The statuses `by` may move an order to from `from`. */
export const nextStatuses = (from: OrderStatusValue, by: OrderActorType): OrderStatusValue[] => TRANSITIONS[from].filter((t) => t.by.includes(by)).map((t) => t.to);

/** Ending an order this way gives its reserved stock back. */
export const releasesStock = (to: OrderStatusValue): boolean => to === "cancelled" || to === "rejected";

/** Still needs someone's attention or is on its way (not finished): what "open" means for deletion and for the per-customer cap. */
export const OPEN_STATUSES: readonly OrderStatusValue[] = ["pending", "confirmed", "preparing", "shipped"];
export const isFinal = (status: OrderStatusValue): boolean => TRANSITIONS[status].length === 0;

export const ORDER_STATUS_LABEL: Record<OrderStatusValue, string> = {
  pending: "در انتظار تأیید",
  confirmed: "تأیید شده",
  preparing: "در حال آماده‌سازی",
  shipped: "ارسال شده",
  delivered: "تحویل داده شده",
  cancelled: "لغو شده",
  rejected: "رد شده",
};

/** The action a staff member takes to reach `to` (button text). */
export const ORDER_ACTION_LABEL: Record<OrderStatusValue, string> = {
  pending: "—",
  confirmed: "تأیید سفارش",
  preparing: "شروع آماده‌سازی",
  shipped: "ثبت ارسال",
  delivered: "ثبت تحویل",
  cancelled: "لغو سفارش",
  rejected: "رد سفارش",
};

/** Whether the reason a staff member writes is shown to the customer (it is, for rejections and cancellations). */
export const needsReason = (to: OrderStatusValue): boolean => to === "rejected" || to === "cancelled";

export const ORDER_REASON_MAX = 200;

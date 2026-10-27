/** The ways an order can reach the customer. `pickup` = the customer collects it in person (no address, no fee). */
export const SHIPPING_METHODS = ["post", "tipax", "local_courier", "pickup"] as const;
export type ShippingMethodKey = (typeof SHIPPING_METHODS)[number];

export const SHIPPING_METHOD_LABEL: Record<ShippingMethodKey, string> = {
  post: "پست",
  tipax: "تیپاکس",
  local_courier: "پیک محلی",
  pickup: "تحویل حضوری",
};

export const isShippingMethod = (value: string): value is ShippingMethodKey => (SHIPPING_METHODS as readonly string[]).includes(value);

/** Everything but in-person pickup needs a delivery address (and a province/city to price it by). */
export const methodNeedsAddress = (method: ShippingMethodKey): boolean => method !== "pickup";

/** Who carried an order: a method's own carrier, or someone else the staff names ("other"). */
export const CARRIERS = [...SHIPPING_METHODS, "other"] as const;
export type CarrierKey = (typeof CARRIERS)[number];
export const CARRIER_LABEL: Record<CarrierKey, string> = { ...SHIPPING_METHOD_LABEL, other: "سایر" };
export const isCarrier = (value: string): value is CarrierKey => (CARRIERS as readonly string[]).includes(value);

/** Longest carrier name / tracking code staff may enter. */
export const CARRIER_NAME_MAX = 60;
export const TRACKING_CODE_MAX = 64;

import { formatOrderNumber } from "../customer/schema";
import { CARRIER_LABEL, type CarrierKey } from "./methods";

export const STORE_NAME = "جریان ما";
export const SHIPMENT_NOTIFICATION_KIND = "shipment_tracking";
/** A failed message is retried by staff at most this many times in total (protects the customer from a loop of identical SMS). */
export const MAX_NOTIFICATION_ATTEMPTS = 5;
/** A send that has been "in flight" this long has an unknown outcome and may be retried by staff. */
export const STALE_SENDING_MS = 15 * 60_000;

export const NOTIFICATION_STATUS_LABEL = { pending: "در انتظار ارسال", sending: "در حال ارسال", sent: "ارسال شد", failed: "ناموفق", skipped: "ارسال نشد" } as const;

/** The SMS: store name, order number, carrier and tracking code, nothing else (no names, addresses or prices). */
export function shipmentSmsText(input: { orderNumber: number; carrier: CarrierKey; carrierName: string | null; trackingCode: string }): string {
  const carrier = input.carrier === "other" ? (input.carrierName ?? CARRIER_LABEL.other) : CARRIER_LABEL[input.carrier];
  return `${STORE_NAME}\nسفارش ${formatOrderNumber(input.orderNumber)} ارسال شد.\nحامل: ${carrier}\nکد رهگیری: ${input.trackingCode}`;
}

/** One message per order, carrier and tracking code: saving the same shipment again never queues another SMS. */
export const shipmentNotificationKey = (orderId: string, carrier: CarrierKey, trackingCode: string): string => `shipment:${orderId}:${carrier}:${trackingCode.toLowerCase()}`;

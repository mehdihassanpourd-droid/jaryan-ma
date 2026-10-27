import { MAX_NOTIFICATION_ATTEMPTS, SHIPMENT_NOTIFICATION_KIND, STALE_SENDING_MS, shipmentNotificationKey, shipmentSmsText } from "../../src/domain/shipping/notification";
import { isCarrier, type CarrierKey } from "../../src/domain/shipping/methods";
import type { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import { SmsDeliveryError, SmsNotConfiguredError, type SmsProvider } from "../sms/provider";

export type NotifierErrorCode = "not_found" | "notifications_disabled" | "not_retryable" | "notification_attempt_limit";

export class NotifierError extends Error {
  constructor(public code: NotifierErrorCode) {
    super(code);
    this.name = "NotifierError";
  }
}

type Tx = Prisma.TransactionClient;

export interface ShipmentNotifierOptions {
  /** OFF unless the owner switched it on (SHIPMENT_SMS_ENABLED) and, in production, configured a real SMS gateway. */
  enabled: boolean;
  /** Runs delivery after the order change has been committed, without making the admin wait for the gateway. */
  background?: (task: Promise<unknown>) => void;
  clock?: () => Date;
  log?: (event: string, detail?: Record<string, unknown>) => void;
}

/**
 * The shipment tracking SMS: queued in the SAME transaction that saves the carrier and tracking code (so a notification
 * exists exactly when a shipment with a code was saved), delivered afterwards through the `SmsProvider` port.
 *
 *  - No duplicates: one row per (order, carrier, tracking code) (unique `dedupeKey`), and a send is claimed with
 *    `UPDATE … WHERE status IN (pending, failed)`, so two workers or a double-click can never both send it.
 *  - Switched off: the row is recorded as `skipped` (reason `notifications_disabled`) and nothing is sent.
 *  - Failures keep a short error code (never a gateway response, never the phone number) and can be retried by staff.
 *  - The phone number is read from the customer at send time and never stored, logged or audited here.
 */
export class ShipmentNotifier {
  private readonly clock: () => Date;
  private readonly log: (event: string, detail?: Record<string, unknown>) => void;

  constructor(
    private readonly db: Db,
    private readonly sms: SmsProvider,
    private readonly options: ShipmentNotifierOptions,
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
  }

  get enabled(): boolean {
    return this.options.enabled;
  }

  /**
   * Queues the SMS for a saved shipment, inside the caller's transaction. Returns the id of a NEW message to deliver
   * (null: nothing to send: no tracking code, pickup, or this exact message was already queued).
   */
  async enqueue(tx: Tx, order: { id: string; number: number }, shipment: { carrier: string; carrierName: string | null; trackingCode: string | null }, now: Date): Promise<string | null> {
    if (!shipment.trackingCode || shipment.carrier === "pickup" || !isCarrier(shipment.carrier)) return null;
    const carrier: CarrierKey = shipment.carrier;
    const id = crypto.randomUUID();
    const created = await tx.orderNotification.createMany({
      data: [
        {
          id,
          orderId: order.id,
          kind: SHIPMENT_NOTIFICATION_KIND,
          dedupeKey: shipmentNotificationKey(order.id, carrier, shipment.trackingCode),
          status: this.options.enabled ? "pending" : "skipped",
          skipReason: this.options.enabled ? null : "notifications_disabled",
          message: shipmentSmsText({ orderNumber: order.number, carrier, carrierName: shipment.carrierName, trackingCode: shipment.trackingCode }),
          createdAt: now,
          updatedAt: now,
        },
      ],
      skipDuplicates: true,
    });
    if (created.count === 0) return null;
    await tx.auditLog.create({
      data: { actorEmail: "system", action: this.options.enabled ? "notification.queued" : "notification.skipped", entity: "order", entityId: order.id, detail: { number: order.number, kind: SHIPMENT_NOTIFICATION_KIND, reason: this.options.enabled ? null : "notifications_disabled" }, at: now },
    });
    return this.options.enabled ? id : null;
  }

  /** Hands freshly queued messages to the background to be sent (the admin's request does not wait for the SMS gateway). */
  dispatch(ids: string[]): void {
    for (const id of ids) {
      const task = this.deliver(id).catch((error: unknown) => this.log("shipment_sms_error", { id, error: error instanceof Error ? error.name : "error" }));
      if (this.options.background) this.options.background(task);
      else void task;
    }
  }

  /** Sends one message if (and only if) this call wins the claim on it. Never throws for a delivery failure: it is recorded. */
  async deliver(id: string, claimFrom: Array<"pending" | "failed" | "skipped"> = ["pending"]): Promise<"sent" | "failed" | "skipped" | "not_claimed"> {
    if (!this.options.enabled) return "not_claimed";
    const now = this.clock();
    const stale = new Date(now.getTime() - STALE_SENDING_MS);
    // The claim: only one caller can move the row to "sending"; everyone else changes nothing and sends nothing.
    const claimed = await this.db.orderNotification.updateMany({
      where: {
        id,
        attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
        OR: [
          ...(claimFrom.includes("pending") ? [{ status: "pending" as const }] : []),
          ...(claimFrom.includes("failed") ? [{ status: "failed" as const }, { status: "sending" as const, lastAttemptAt: { lt: stale } }] : []),
          // Only messages that were skipped because the feature was off can be sent later; "no recipient" never can.
          ...(claimFrom.includes("skipped") ? [{ status: "skipped" as const, skipReason: "notifications_disabled" }] : []),
        ],
      },
      data: { status: "sending", attempts: { increment: 1 }, lastAttemptAt: now, updatedAt: now, skipReason: null },
    });
    if (claimed.count !== 1) return "not_claimed";

    const row = await this.db.orderNotification.findUniqueOrThrow({ where: { id }, include: { order: { select: { number: true, customer: { select: { phone: true, status: true } } } } } });
    const customer = row.order.customer;
    if (customer.status !== "active") {
      // Anonymised or blocked: there is nobody to send to. Not an error, and not retryable.
      await this.finish(id, row.order.number, "skipped", { skipReason: "no_recipient", lastError: null }, row.attempts);
      return "skipped";
    }
    try {
      const result = await this.sms.send({ to: customer.phone, text: row.message });
      await this.finish(id, row.order.number, "sent", { providerMessageId: result.providerMessageId, lastError: null, sentAt: this.clock() }, row.attempts);
      return "sent";
    } catch (error) {
      const code = error instanceof SmsNotConfiguredError ? "sms_not_configured" : error instanceof SmsDeliveryError && /^[a-z0-9_]{1,60}$/.test(error.message) ? error.message : "sms_send_failed";
      await this.finish(id, row.order.number, "failed", { lastError: code }, row.attempts);
      return "failed";
    }
  }

  private async finish(id: string, number: number, status: "sent" | "failed" | "skipped", data: Prisma.OrderNotificationUpdateInput, attempts: number): Promise<void> {
    const now = this.clock();
    await this.db.$transaction([
      this.db.orderNotification.update({ where: { id }, data: { ...data, status, updatedAt: now } }),
      this.db.auditLog.create({
        // No phone number, no message text, no gateway response: the notification id, the order number, the outcome and a short code.
        data: { actorEmail: "system", action: `notification.${status}`, entity: "order_notification", entityId: id, detail: { number, kind: SHIPMENT_NOTIFICATION_KIND, attempts, error: typeof data.lastError === "string" ? data.lastError : null }, at: now },
      }),
    ]);
    this.log("shipment_sms", { id, number, status, attempts, ...(typeof data.lastError === "string" ? { error: data.lastError } : {}) });
  }

  /** Staff retry a failed (or never-sent because the feature was off, or stuck "sending") message. Safe to press twice: one SMS at most. */
  async retry(orderNumber: number, notificationId: string, actorLabel: string | null): Promise<"sent" | "failed" | "skipped"> {
    if (!this.options.enabled) throw new NotifierError("notifications_disabled");
    const row = await this.db.orderNotification.findFirst({ where: { id: notificationId, order: { number: orderNumber } }, select: { id: true, status: true, attempts: true, skipReason: true, lastAttemptAt: true } });
    if (!row) throw new NotifierError("not_found");
    if (row.attempts >= MAX_NOTIFICATION_ATTEMPTS) throw new NotifierError("notification_attempt_limit");
    const outcome = await this.deliver(row.id, ["failed", "skipped"]);
    if (outcome === "not_claimed") throw new NotifierError("not_retryable");
    await this.db.auditLog.create({ data: { actorEmail: actorLabel ?? "staff", action: "notification.retry", entity: "order_notification", entityId: row.id, detail: { number: orderNumber, from: row.status, outcome }, at: this.clock() } });
    return outcome;
  }
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../db/test-database";
import { buildTestApp, call as adminCall, type Session, type TestApp } from "../testing/app";
import { shop, SHIPPING, type Customer } from "../testing/shop";
import { MemorySmsProvider, SmsDeliveryError, type SmsMessage, type SmsResult } from "../sms/provider";

/** A mock gateway: records every message (OTP codes too, so sign-in works), can be told how to fail, and can be slowed to expose races. */
class MockSms extends MemorySmsProvider {
  attempts = 0;
  failures: Error[] = [];
  delayMs = 0;
  override async send(message: SmsMessage): Promise<SmsResult> {
    this.attempts++;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const failure = this.failures.shift();
    if (failure) throw failure;
    return super.send(message);
  }
}

let testDb: TestDatabase;
let app: TestApp;
let owner: Session;
let sms: MockSms;
let S: ReturnType<typeof shop>;
let me: Customer;

beforeAll(async () => void (testDb = await createTestDatabase()), 60_000);
afterAll(async () => testDb.close());

async function boot(enabled: boolean) {
  sms = new MockSms();
  app = await buildTestApp(testDb, { shipmentSms: enabled, sms });
  const category = (await app.repo.createCategory({ slug: "wall", name: "دیوارکوب" })).id;
  owner = await app.session("owner");
  S = shop(() => app, () => testDb, () => category);
  me = await S.signIn();
  sms.sent.length = 0; // the sign-in code is not part of what these tests count
  sms.attempts = 0;
}
const newOrder = async (name = "اثر") => {
  const p = await S.product({ name, fulfillment: "stocked", inventory: 10 });
  const r = await S.place(me, [{ slug: p.slug, quantity: 1 }], { deliveryMethod: "post", expectedFeeToman: 0, shipping: SHIPPING });
  expect(r.status).toBe(201);
  return r.body.order.number as number;
};
const move = (number: number, to: string, expectedStatus: string, extra: Record<string, unknown> = {}) =>
  adminCall(app, { method: "POST", path: `/api/v1/orders/${number}/transition`, as: owner, body: { to, expectedStatus, ...extra } });
const toShipping = async (number: number) => {
  await move(number, "confirmed", "pending");
  await move(number, "preparing", "confirmed");
};
const ship = async (number: number, shipment?: Record<string, unknown>) => {
  const r = await move(number, "shipped", "preparing", shipment ? { shipment } : {});
  await app.settle();
  return r;
};
const rows = (number: number) => testDb.db.orderNotification.findMany({ where: { order: { number } }, orderBy: { createdAt: "asc" } });
const setShipment = async (number: number, body: unknown, as: Session | null = owner) => {
  const r = await adminCall(app, { method: "PUT", path: `/api/v1/orders/${number}/shipment`, as, body });
  await app.settle();
  return r;
};
const retry = async (number: number, id: string, as: Session | null = owner) => {
  const r = await adminCall(app, { method: "POST", path: `/api/v1/orders/${number}/notifications/${id}/retry`, as });
  await app.settle();
  return r;
};

describe("tracking SMS, feature ON (mock gateway)", () => {
  beforeEach(() => boot(true));

  it("shipping with a tracking code sends exactly one SMS with store name, order number, carrier and code", async () => {
    const n = await newOrder();
    await toShipping(n);
    const r = await ship(n, { carrier: "tipax", trackingCode: "TX-5551234" });
    expect(r.status).toBe(200);
    expect(sms.sent).toEqual([{ to: me.phone, text: `جریان ما\nسفارش JM-${100000 + n} ارسال شد.\nحامل: تیپاکس\nکد رهگیری: TX-5551234` }]);
    const [row] = await rows(n);
    expect(row).toMatchObject({ status: "sent", attempts: 1, providerMessageId: "mem-1", lastError: null, kind: "shipment_tracking" });
    expect(row!.sentAt).not.toBeNull();
    // the admin sees it, the customer's order carries the tracking (account display)
    const staff = await adminCall(app, { path: `/api/v1/orders/${n}`, as: owner });
    expect(staff.body.order.notifications).toMatchObject({ enabled: true, items: [{ status: "sent", attempts: 1 }] });
    const mine = await S.call(`/api/v1/customer/orders/${n}`, { as: me });
    expect(mine.body.order.shipment).toMatchObject({ carrier: "tipax", trackingCode: "TX-5551234" });
  });

  it("the carrier name written for 'other' is what the customer reads", async () => {
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "other", carrierName: "پیک فروشگاه", trackingCode: "PK-1" });
    expect(sms.sent[0]!.text).toContain("حامل: پیک فروشگاه");
  });

  it("no SMS without a tracking code, for pickup, or before the order has shipped", async () => {
    const a = await newOrder("کالای الف");
    await toShipping(a);
    await ship(a, { carrier: "post" }); // carrier only
    const b = await newOrder("کالای ب");
    await toShipping(b);
    await ship(b, { carrier: "pickup" });
    const c = await newOrder("کالای ج");
    await toShipping(c);
    expect((await setShipment(c, { carrier: "post", trackingCode: "EARLY-1" })).status).toBe(200); // saved while preparing
    expect(sms.sent).toHaveLength(0);
    expect(await rows(c)).toHaveLength(0);
    // ... the code saved earlier goes out when the order is marked shipped
    await ship(c);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]!.text).toContain("EARLY-1");
  });

  it("never sends the same message twice: re-saving, re-shipping races and a double click", async () => {
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    for (let i = 0; i < 3; i++) await setShipment(n, { carrier: "post", trackingCode: "ab-1" }); // same code (any case), same carrier
    await Promise.all([1, 2, 3, 4].map(() => setShipment(n, { carrier: "post", trackingCode: "AB-1" })));
    expect(sms.sent).toHaveLength(1);
    expect(await rows(n)).toHaveLength(1);
  });

  it("a corrected tracking code is new information: one more SMS, once", async () => {
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    await setShipment(n, { carrier: "post", trackingCode: "AB-2" });
    await setShipment(n, { carrier: "post", trackingCode: "AB-2" });
    expect(sms.sent.map((m) => /AB-\d/.exec(m.text)![0])).toEqual(["AB-1", "AB-2"]);
    expect((await rows(n)).map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("a correction after delivery stays silent", async () => {
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    await move(n, "delivered", "shipped");
    await setShipment(n, { carrier: "post", trackingCode: "AB-9" });
    expect(sms.sent).toHaveLength(1);
  });

  it("a failed send is recorded with a short code (no phone, no gateway text) and can be retried once to success", async () => {
    sms.failures.push(new SmsDeliveryError("sms_gateway_status_502"));
    const n = await newOrder();
    await toShipping(n);
    expect((await ship(n, { carrier: "post", trackingCode: "AB-1" })).status).toBe(200); // the admin's action is not blocked by the gateway
    const [failed] = await rows(n);
    expect(failed).toMatchObject({ status: "failed", attempts: 1, lastError: "sms_gateway_status_502", sentAt: null });
    expect(sms.sent).toHaveLength(0);

    const r = await retry(n, failed!.id);
    expect(r.status).toBe(200);
    expect(r.body.order.notifications.items[0]).toMatchObject({ status: "sent", attempts: 2, lastError: null });
    expect(sms.sent).toHaveLength(1);
    // retrying a message that already went out is refused and sends nothing
    const again = await retry(n, failed!.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("not_retryable");
    expect(sms.sent).toHaveLength(1);
  });

  it("unknown gateway errors are stored as a generic code, never their text", async () => {
    sms.failures.push(new Error("ECONNREFUSED 10.1.2.3 secret-token-xyz"));
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    const [row] = await rows(n);
    expect(row!.lastError).toBe("sms_send_failed");
    expect(JSON.stringify(await testDb.db.auditLog.findMany())).not.toMatch(/secret-token|10\.1\.2\.3/);
  });

  it("many simultaneous retries of one failed message send exactly one SMS", async () => {
    sms.failures.push(new SmsDeliveryError("sms_gateway_unreachable"));
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    const [failed] = await rows(n);
    sms.delayMs = 80; // keep the winner "in flight" while the others try
    const results = await Promise.all(Array.from({ length: 6 }, () => adminCall(app, { method: "POST", path: `/api/v1/orders/${n}/notifications/${failed!.id}/retry`, as: owner })));
    await app.settle();
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(sms.sent).toHaveLength(1);
    expect(sms.attempts).toBe(2); // the failed first attempt + the single retry
  });

  it("stops after the attempt limit so a customer is never flooded", async () => {
    const n = await newOrder();
    await toShipping(n);
    for (let i = 0; i < 5; i++) sms.failures.push(new SmsDeliveryError("sms_gateway_status_500"));
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    const [row] = await rows(n);
    for (let i = 0; i < 4; i++) expect((await retry(n, row!.id)).status).toBe(200);
    expect((await rows(n))[0]).toMatchObject({ status: "failed", attempts: 5 });
    const over = await retry(n, row!.id);
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("notification_attempt_limit");
    expect(sms.attempts).toBe(5);
  });

  it("a send whose outcome is unknown (stuck 'sending') can be retried only after it is stale", async () => {
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    const [row] = await rows(n);
    await testDb.db.orderNotification.update({ where: { id: row!.id }, data: { status: "sending", lastAttemptAt: app.now() } });
    expect((await retry(n, row!.id)).status).toBe(409); // just started: someone may be sending right now
    app.advance(16 * 60_000);
    expect((await retry(n, row!.id)).status).toBe(200);
    expect((await rows(n))[0]).toMatchObject({ status: "sent" });
  });

  it("an anonymised customer is skipped without error and without any SMS", async () => {
    const n = await newOrder();
    await toShipping(n);
    await app.platform.accountStore.anonymize(me.id, app.now());
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    expect(sms.sent).toHaveLength(0);
    expect((await rows(n))[0]).toMatchObject({ status: "skipped", skipReason: "no_recipient" });
    expect((await retry(n, (await rows(n))[0]!.id)).status).toBe(409); // nobody to send to: not retryable
  });

  it("logs status without personal data; audit and server log carry no phone number or message text", async () => {
    sms.failures.push(new SmsDeliveryError("sms_gateway_status_503"));
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "ZZ-4242" });
    await retry(n, (await rows(n))[0]!.id);
    const audit = JSON.stringify((await testDb.db.auditLog.findMany({ where: { action: { startsWith: "notification." } } })).map((a) => [a.action, a.detail]));
    expect(audit).toContain("notification.failed");
    expect(audit).toContain("notification.sent");
    expect(audit).toContain("notification.retry");
    expect(audit).not.toContain(me.phone);
    expect(audit).not.toContain("ZZ-4242");
    const logs = JSON.stringify(app.logs.filter((l) => l.event.startsWith("shipment_sms")));
    expect(logs).toContain("sms_gateway_status_503");
    expect(logs).not.toContain(me.phone.slice(3));
    expect(logs).not.toContain("ZZ-4242");
    expect(JSON.stringify(await testDb.db.orderNotification.findMany())).not.toContain(me.phone.slice(3)); // the phone is never stored in the outbox
  });

  it("retry needs order:manage (support yes; editor, viewer, anonymous no)", async () => {
    sms.failures.push(new SmsDeliveryError("sms_gateway_status_500"));
    const n = await newOrder();
    await toShipping(n);
    await ship(n, { carrier: "post", trackingCode: "AB-1" });
    const id = (await rows(n))[0]!.id;
    expect((await retry(n, id, await app.session("editor"))).status).toBe(403);
    expect((await retry(n, id, await app.session("viewer"))).status).toBe(403);
    expect((await retry(n, id, null)).status).toBe(401);
    expect((await retry(n, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await retry(n, id, await app.session("support"))).status).toBe(200);
  });

  it("an id from another order cannot be retried through this one", async () => {
    sms.failures.push(new SmsDeliveryError("sms_gateway_status_500"));
    const a = await newOrder("کالای الف");
    const b = await newOrder("کالای ب");
    await toShipping(a);
    await ship(a, { carrier: "post", trackingCode: "AB-1" });
    const idA = (await rows(a))[0]!.id;
    expect((await retry(b, idA)).status).toBe(404);
  });
});

describe("tracking SMS, feature OFF (the default)", () => {
  beforeEach(() => boot(false));

  it("saves carrier and tracking, shows them to the customer, records the message as skipped and sends nothing", async () => {
    const n = await newOrder();
    await toShipping(n);
    const r = await ship(n, { carrier: "tipax", trackingCode: "TX-1" });
    expect(r.status).toBe(200);
    expect(r.body.order.shipment).toMatchObject({ carrier: "tipax", trackingCode: "TX-1" });
    expect(sms.attempts).toBe(0);
    expect((await rows(n))[0]).toMatchObject({ status: "skipped", skipReason: "notifications_disabled", attempts: 0 });
    expect(r.body.order.notifications.enabled).toBe(false);
    const mine = await S.call(`/api/v1/customer/orders/${n}`, { as: me });
    expect(mine.body.order.shipment.trackingCode).toBe("TX-1");
    // no retry while it is off; and re-saving does not queue anything new
    const id = (await rows(n))[0]!.id;
    const refused = await retry(n, id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("notifications_disabled");
    await setShipment(n, { carrier: "tipax", trackingCode: "TX-1" });
    expect(await rows(n)).toHaveLength(1);
    expect(sms.attempts).toBe(0);
  });
});

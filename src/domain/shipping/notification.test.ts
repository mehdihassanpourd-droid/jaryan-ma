import { describe, expect, it } from "vitest";
import { shipmentNotificationKey, shipmentSmsText } from "./notification";

describe("shipment SMS text", () => {
  it("has the store name, order number, carrier and tracking code, and nothing else", () => {
    expect(shipmentSmsText({ orderNumber: 1, carrier: "tipax", carrierName: null, trackingCode: "TX-5551234" })).toBe("جریان ما\nسفارش JM-100001 ارسال شد.\nحامل: تیپاکس\nکد رهگیری: TX-5551234");
  });
  it("uses the staff-written name for 'other'", () => {
    expect(shipmentSmsText({ orderNumber: 7, carrier: "other", carrierName: "پیک آزاد", trackingCode: "A1" })).toContain("حامل: پیک آزاد");
  });
  it("keys one message per order, carrier and code (case-insensitive code)", () => {
    expect(shipmentNotificationKey("o1", "post", "AB-1")).toBe(shipmentNotificationKey("o1", "post", "ab-1"));
    expect(shipmentNotificationKey("o1", "post", "AB-1")).not.toBe(shipmentNotificationKey("o1", "post", "AB-2"));
    expect(shipmentNotificationKey("o1", "post", "AB-1")).not.toBe(shipmentNotificationKey("o1", "tipax", "AB-1"));
    expect(shipmentNotificationKey("o1", "post", "AB-1")).not.toBe(shipmentNotificationKey("o2", "post", "AB-1"));
  });
});

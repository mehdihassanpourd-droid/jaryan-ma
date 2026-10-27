import { describe, expect, it } from "vitest";
import { MAX_TOMAN } from "../money";
import { normalizeIranMobile, maskPhone, toNationalFormat } from "../phone";
import { IRAN_PROVINCES, isIranProvince, normalizePostalCode } from "./geo";
import { addressInputSchema, formatOrderNumber, formatTicketNumber, newOrderSchema, otpCodeSchema, otpRequestSchema, otpVerifySchema, profileUpdateSchema, scrubShipping } from "./schema";

describe("normalizeIranMobile", () => {
  it.each([
    "09121234567", "9121234567", "+989121234567", "+98 912 123 4567", "0098-912-123-4567", "989121234567",
    "۰۹۱۲۱۲۳۴۵۶۷", "٠٩١٢١٢٣٤٥٦٧", " 0912 123 4567 ", "(0912) 123-4567", "09.12.123.4567",
  ])("accepts %s", (input) => expect(normalizeIranMobile(input)).toBe("+989121234567"));

  it.each([
    "", "   ", "0912123456", "091212345678", "02112345678", "+441234567890", "+1 555 123 4567", "08121234567",
    "09999999999", "abc", "0912-abc-4567", "09+121234567", "+9121234567", "9".repeat(31), "0912123456a", "۰۹۱۲۱۲۳۴۵۶",
  ])("rejects %j", (input) => expect(normalizeIranMobile(input)).toBeNull());

  it("masks and formats for display", () => {
    expect(maskPhone("+989121234567")).toBe("+98912***4567");
    expect(maskPhone("deleted:abc")).toBe("***");
    expect(toNationalFormat("+989121234567")).toBe("09121234567");
  });
});

describe("Iranian geography", () => {
  it("has the 31 provinces, each unique", () => {
    expect(IRAN_PROVINCES).toHaveLength(31);
    expect(new Set(IRAN_PROVINCES).size).toBe(31);
    expect(isIranProvince("تهران")).toBe(true);
    expect(isIranProvince("Tehran")).toBe(false);
  });

  it.each(["1136813111", "8185915711", "۱۱۳۶۸۱۳۱۱۱", "11368-13111", "1631813781", "9815718354"])("accepts the postal code %s", (code) => {
    expect(normalizePostalCode(code)).toMatch(/^\d{10}$/);
  });
  it.each(["", "123", "0123456789", "2136813111", "1111813111", "1136013111", "1136213111", "11368131", "113681311122", "1136813112".replace("2", "2") + "x"])("rejects the postal code %j", (code) => {
    expect(normalizePostalCode(code)).toBeNull();
  });
});

describe("OTP schemas", () => {
  it("normalises the phone and accepts Persian digits in the code", () => {
    expect(otpRequestSchema.parse({ phone: "۰۹۱۲۱۲۳۴۵۶۷" })).toEqual({ phone: "+989121234567" });
    expect(otpVerifySchema.parse({ phone: "09121234567", code: "۱۲۳ ۴۵۶", acceptTerms: true })).toEqual({ phone: "+989121234567", code: "123456", acceptTerms: true });
  });
  it.each(["12345", "1234567", "abcdef", "", "12 34 5"])("rejects the code %j", (code) => expect(otpCodeSchema.safeParse(code).success).toBe(false));
  it("rejects bad phones and unknown fields", () => {
    expect(otpRequestSchema.safeParse({ phone: "12345" }).success).toBe(false);
    expect(otpRequestSchema.safeParse({ phone: "09121234567", role: "admin" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: "09121234567", code: "123456", status: "active" }).success).toBe(false);
  });
});

describe("profile updates", () => {
  it("accepts, trims, fixes Arabic letters, clears with empty strings", () => {
    expect(profileUpdateSchema.parse({ firstName: "  علي ", lastName: "", email: " Ali@Example.COM ", marketingOptIn: true })).toEqual({
      firstName: "علی", lastName: null, email: "ali@example.com", marketingOptIn: true,
    });
    expect(profileUpdateSchema.parse({ email: "" })).toEqual({ email: null });
    expect(profileUpdateSchema.parse({})).toEqual({});
  });
  it("refuses mass assignment and bad values", () => {
    for (const bad of [{ status: "active" }, { phone: "09121234567" }, { id: "x" }, { role: "admin" }, { email: "nope" }, { firstName: "x".repeat(60) }, { marketingOptIn: "yes" }]) {
      expect(profileUpdateSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("addresses", () => {
  const valid = { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر، کوچه گل", postalCode: "۱۱۳۶۸۱۳۱۱۱" };
  it("accepts and normalises a complete address", () => {
    expect(addressInputSchema.parse({ ...valid, label: "خانه", plaque: "12", unit: "4" })).toMatchObject({
      recipientPhone: "+989121234567", postalCode: "1136813111", label: "خانه", plaque: "12", unit: "4", isDefault: false, notes: null,
    });
  });
  it.each([
    [{ recipientName: "ع" }], [{ recipientPhone: "021" }], [{ province: "Tehran" }], [{ city: "ت" }], [{ street: "کوچه" }],
    [{ postalCode: "0000000000" }], [{ isDefault: "true" }], [{ ownerId: "x" }], [{ street: "x".repeat(201) }],
  ])("rejects %j", (patch) => expect(addressInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false));
});

describe("orders (large totals computed exactly)", () => {
  const shipping = { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر", postalCode: "1136813111" };
  const item = (unit: number, quantity = 1) => ({ productId: "p", vendorId: "v", titleSnapshot: "اثر", unitPriceToman: unit, quantity });
  const delivery = (feeToman = 0, method = "post") => ({ method, feeToman, details: { rateId: null, weightGrams: 500, free: false, etaMinDays: null, etaMaxDays: null, note: null } });
  const order = (items: ReturnType<typeof item>[], totalToman: number, extra: Record<string, unknown> = {}) => newOrderSchema.safeParse({ customerId: "c", items, shipping, delivery: delivery(), totalToman, ...extra });

  it("accepts a total equal to the exact sum, including values above 2^31 and 2^40", () => {
    expect(order([item(1_500_000, 3), item(2_000_000_000_000)], 2_000_004_500_000).success).toBe(true);
  });
  it("rejects a wrong total, and totals beyond the supported range", () => {
    const wrong = order([item(1000, 2)], 2001);
    expect(wrong.success).toBe(false);
    expect(!wrong.success && wrong.error.issues[0]?.message).toBe("order_total_mismatch");
    const huge = order([item(MAX_TOMAN, 2)], MAX_TOMAN);
    expect(!huge.success && huge.error.issues.map((i) => i.message)).toContain("order_total_out_of_range");
  });
  it("adds the delivery fee to the total: the sum must be goods + fee, exactly", () => {
    expect(order([item(1000, 2)], 2000 + 85_000, { delivery: delivery(85_000) }).success).toBe(true);
    expect(order([item(1000, 2)], 2000, { delivery: delivery(85_000) }).success).toBe(false); // fee forgotten
    const huge = order([item(MAX_TOMAN)], MAX_TOMAN, { delivery: delivery(1) });
    expect(!huge.success && huge.error.issues.map((i) => i.message)).toContain("order_total_out_of_range");
  });
  it("carried deliveries need a whole address; pickup needs none but must be free", () => {
    const pickupShipping = { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "", city: "" };
    expect(order([item(1000)], 1000, { shipping: pickupShipping, delivery: delivery(0, "pickup") }).success).toBe(true);
    const free = order([item(1000)], 1500, { shipping: pickupShipping, delivery: delivery(500, "pickup") });
    expect(!free.success && free.error.issues.map((i) => i.message)).toContain("pickup_is_free");
    const noAddress = order([item(1000)], 1000, { shipping: pickupShipping });
    expect(!noAddress.success && noAddress.error.issues.map((i) => i.message)).toContain("address_required");
  });
  it("limits lines and quantities", () => {
    expect(order([], 0).success).toBe(false);
    expect(order([item(1, 1001)], 1001).success).toBe(false);
    expect(order(Array.from({ length: 101 }, () => item(1)), 101).success).toBe(false);
  });
  it("formats human-friendly numbers", () => {
    expect(formatOrderNumber(1)).toBe("JM-100001");
    expect(formatTicketNumber(42)).toBe("T-1042");
  });
});

describe("scrubShipping", () => {
  it("removes personal parts but keeps province and city", () => {
    expect(scrubShipping({ recipientName: "علی", recipientPhone: "+989121234567", province: "تهران", city: "تهران", street: "ولیعصر", postalCode: "1136813111", plaque: "1", unit: "2" })).toEqual({
      recipientName: "[حذف شده]", recipientPhone: null, province: "تهران", city: "تهران", street: "[حذف شده]", plaque: null, unit: null, postalCode: null,
    });
    expect(scrubShipping(null).province).toBe("");
  });
});

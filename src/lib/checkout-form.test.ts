import { describe, expect, it } from "vitest";
import { emptyShippingForm, formFromAddress, localPhone, validateShipping } from "./checkout-form";
import { buildOrderText } from "./order-text";
import { priceLine } from "./cart-pricing";
import type { PublicProduct } from "@/domain/product/snapshot";

const GOOD = { ...emptyShippingForm(), recipientName: "علی رضایی", recipientPhone: "۰۹۱۲۱۲۳۴۵۶۷", province: "تهران", city: "تهران", street: "خیابان ولیعصر، کوچه گل", postalCode: "۱۴۵۹۸۱۳۱۷۶" };

describe("validateShipping (the server's own rules)", () => {
  it("accepts Persian digits and normalises the phone and postal code", () => {
    const r = validateShipping({ ...GOOD, plaque: "۱۲", unit: "۳", customerNote: "  زنگ نزنید  " });
    expect(r.ok && r.shipping).toMatchObject({ recipientPhone: "+989121234567", postalCode: "1459813176", plaque: "۱۲", unit: "۳" });
    expect(r.ok && r.customerNote).toBe("زنگ نزنید");
  });

  it("reports each wrong field in Persian, and only that field", () => {
    const r = validateShipping({ ...GOOD, recipientPhone: "12345", postalCode: "123", province: "", street: "ab", city: "" });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["city", "postalCode", "province", "recipientPhone", "street"]);
    expect(!r.ok && r.errors.recipientPhone).toContain("۰۹۱۲۳۴۵۶۷۸۹");
  });

  it("rejects a note over 300 characters and an unknown province", () => {
    expect(validateShipping({ ...GOOD, customerNote: "x".repeat(301) }).ok).toBe(false);
    expect(validateShipping({ ...GOOD, province: "جایی که نیست" }).ok).toBe(false);
  });
});

describe("address -> form", () => {
  it("shows the phone the way people write it", () => {
    expect(localPhone("+989121234567")).toBe("09121234567");
    expect(formFromAddress({ id: "a", recipientName: "ن", recipientPhone: "+989121234567", province: "تهران", city: "تهران", street: "خیابان", plaque: null, unit: null, postalCode: "1459813176", isDefault: true }).recipientPhone).toBe("09121234567");
  });
});

describe("order text for an Instagram message", () => {
  const product: PublicProduct = { slug: "rug", name: "گلیم", description: "", seoTitle: null, seoDescription: null, category: null, fulfillment: "stocked", priceToman: 1_000_000, availability: "in_stock", leadTimeDays: null, images: [], variants: [{ sku: "S", options: { اندازه: "۵۰×۷۰" }, priceToman: 500_000, available: true }] };
  it("lists the lines, the exact total, the recipient and says shipping is not included", () => {
    const priced = [priceLine({ slug: "rug", sku: "S", quantity: 2 }, product), priceLine({ slug: "gone", sku: null, quantity: 1 }, null)];
    const r = validateShipping(GOOD);
    if (!r.ok) throw new Error("form should be valid");
    const text = buildOrderText(priced, 1_000_000n, r.shipping, null);
    expect(text).toContain("۱) گلیم — ۵۰×۷۰ — ۲ عدد × ۵۰۰٬۰۰۰ تومان");
    expect(text).not.toContain("gone");
    expect(text).toContain("جمع کالاها: ۱٬۰۰۰٬۰۰۰ تومان (هزینهٔ ارسال لحاظ نشده)");
    expect(text).toContain("موبایل: 09121234567");
    expect(text).toContain("کد پستی 1459813176");
  });
});

describe("pickup contact", () => {
  it("needs only a name and a phone (nothing about an address)", async () => {
    const { validatePickup, emptyShippingForm } = await import("./checkout-form");
    const ok = validatePickup({ ...emptyShippingForm(), recipientName: "علی رضایی", recipientPhone: "۰۹۱۲۳۴۵۶۷۸۹" });
    expect(ok.ok && ok.shipping).toEqual({ recipientName: "علی رضایی", recipientPhone: "+989123456789" });
    const bad = validatePickup({ ...emptyShippingForm(), recipientName: "ع", recipientPhone: "12" });
    expect(!bad.ok && Object.keys(bad.errors).sort()).toEqual(["recipientName", "recipientPhone"]);
  });
});

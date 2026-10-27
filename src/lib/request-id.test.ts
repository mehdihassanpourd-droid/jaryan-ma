import { describe, expect, it } from "vitest";
import { checkoutRequestSchema } from "@/domain/customer/checkout";
import { newRequestId } from "./request-id";

describe("newRequestId", () => {
  it("is a valid v4 UUID the server accepts, with or without crypto.randomUUID", () => {
    const withoutNative = newRequestId({ getRandomValues: ((a: Uint8Array<ArrayBuffer>) => globalThis.crypto.getRandomValues(a)) as Crypto["getRandomValues"] });
    expect(withoutNative).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const native = newRequestId();
    for (const id of [withoutNative, native]) {
      expect(checkoutRequestSchema.safeParse({ items: [{ slug: "a", quantity: 1 }], shipping: { recipientName: "علی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر", postalCode: "1459813176" }, requestId: id }).success).toBe(true);
    }
    expect(newRequestId()).not.toBe(native);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are asserted field by field */
import { expect } from "vitest";
import { CLIENT_IP_HEADER, CSRF_HEADER } from "../api";
import type { TestDatabase } from "../db/test-database";
import { CUSTOMER_COOKIE, STORE_ORIGIN, type TestApp } from "./app";
import { validateProductInput } from "../../src/domain/product/schema";

/** Helpers for tests that drive the customer API (sign in, place orders) and prepare products. Not part of the app. */
export interface Customer {
  cookie: string;
  csrf: string;
  id: string;
  phone: string;
}

export const SHIPPING = { recipientName: "علی رضایی", recipientPhone: "09121234567", province: "تهران", city: "تهران", street: "خیابان ولیعصر، کوچه گل", postalCode: "1459813176" };

let counter = 0;
export const requestId = () => `00000000-0000-4000-9000-${String(++counter).padStart(12, "0")}`;

export function shop(app: () => TestApp, testDb: () => TestDatabase, categoryId: () => string) {
  const ACTOR = "owner@example.test";

  async function product(raw: Record<string, unknown>, status: "published" | "draft" | "archived" = "published") {
    const parsed = validateProductInput({ fulfillment: "unique", categoryId: categoryId(), images: [{ key: "images/p/a.webp", alt: "تصویر" }], priceToman: 1_000_000, ...raw });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    let p = await app().catalog.create({ ...parsed.value, status: "draft" }, ACTOR);
    if (status !== "draft") p = await app().catalog.setStatus(p.id, status, p.version, ACTOR);
    return p;
  }

  async function call(path: string, o: { method?: string; as?: Customer | null; body?: unknown; origin?: string | null; csrf?: string | null; ip?: string } = {}) {
    const method = o.method ?? "GET";
    const headers: Record<string, string> = { [CLIENT_IP_HEADER]: o.ip ?? "198.51.100.5" };
    if (o.as) headers.cookie = o.as.cookie;
    if (method !== "GET") {
      if (o.origin !== null) headers.origin = o.origin ?? STORE_ORIGIN;
      const csrf = o.csrf === undefined ? o.as?.csrf : o.csrf;
      if (csrf) headers[CSRF_HEADER] = csrf;
    }
    let body: string | undefined;
    if (o.body !== undefined) {
      body = JSON.stringify(o.body);
      headers["content-type"] = "application/json";
    }
    const res = await app().customerApi(new Request(`https://api.example.test${path}`, { method, headers, body }));
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : null) as any, res };
  }

  /** Signs a customer in over HTTP (each with their own phone and address, so rate limits never interfere). */
  let phoneSeq = 0;
  async function signIn(): Promise<Customer> {
    const n = ++phoneSeq;
    const local = `0912${String(10_000_000 + n).slice(1)}`;
    const e164 = `+98${local.slice(1)}`;
    const ip = `203.0.113.${(n % 250) + 1}`;
    await call("/api/v1/customer/auth/request-code", { method: "POST", body: { phone: local }, ip });
    const r = await call("/api/v1/customer/auth/verify", { method: "POST", body: { phone: local, code: app().sms.lastCode(e164)!, acceptTerms: true }, ip });
    expect(r.status).toBe(200);
    const token = /jm_c=([^;]+)/.exec(r.res.headers.get("set-cookie") ?? "")?.[1];
    const me = await testDb().db.customer.findUniqueOrThrow({ where: { phone: e164 } });
    return { cookie: `${CUSTOMER_COOKIE}=${token}`, csrf: r.body.csrfToken, id: me.id, phone: e164 };
  }

  const place = (as: Customer | null, items: unknown[], extra: Record<string, unknown> = {}, o: Parameters<typeof call>[1] = {}) =>
    call("/api/v1/customer/orders", { method: "POST", as, body: { items, shipping: SHIPPING, deliveryMethod: "post", expectedFeeToman: 0, requestId: requestId(), ...extra }, ...o });

  return { product, call, signIn, place, ACTOR };
}

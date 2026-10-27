import { expect as pw } from "playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import type { BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminCatalog } from "./admin-api";
import { startHarness, type Harness } from "./harness";
import { chooseDelivery, signInOnCheckout } from "./shop-helpers";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * Shipping and delivery end to end, in real browsers at phone size and (when E2E_DATABASE_URL is set) on real PostgreSQL:
 * the owner sets prices in the real admin screen (methods, destinations, weights, free-shipping threshold, pickup); the
 * customer sees the SERVER's prices before ordering and pays what was shown; a price changed meanwhile is refused with the new
 * fee; free shipping, pickup (no address) and "not served" destinations; the order keeps its fee when prices change later;
 * the owner enters carrier and tracking and the customer sees them. No request leaves the local servers.
 */
const ADMIN_PORT = 47834;
const CUSTOMER = { local: "09121234567", e164: "+989121234567", name: "علی رضایی" };
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

let h: Harness;
let site: { dir: string; server: Server; url: string };
const hosts = new Set<string>();

beforeAll(async () => {
  const dir = buildStorefront({ NEXT_PUBLIC_CATALOG_URL: `http://127.0.0.1:${ADMIN_PORT}/media`, NEXT_PUBLIC_ORDER_API_URL: `http://127.0.0.1:${ADMIN_PORT}` });
  site = { dir, ...(await serveStatic(dir)) };
  h = await startHarness({ port: ADMIN_PORT, customerOrigins: site.url, ...(process.env.E2E_DATABASE_URL ? { databaseUrl: process.env.E2E_DATABASE_URL } : {}) });
}, 600_000);
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(80)}`);
});
afterAll(async () => {
  await h?.stop();
  site?.server.closeAllConnections();
  await new Promise((r) => (site ? site.server.close(r) : r(undefined)));
  if (site) rmSync(site.dir, { recursive: true, force: true });
});

const phone = async (): Promise<BrowserContext> => {
  const ctx = await h.browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR" });
  ctx.on("request", (r) => {
    if (/^(https?|wss?):/.test(r.url())) hosts.add(new URL(r.url()).host);
  });
  return ctx;
};
const noSideScroll = async (page: Page, where: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal scroll on ${where}`).toBeLessThanOrEqual(0);
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: Document, o: object): Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}
const REAL = Boolean(process.env.E2E_DATABASE_URL);
const sql = (query: string): string | null => (REAL ? execFileSync("psql", [process.env.E2E_DATABASE_URL as string, "-At", "-c", query], { encoding: "utf8" }).trim() : null);
const shot = async (page: Page, name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }); };
const toast = (page: Page, text: string | RegExp) => page.locator(".toast", { hasText: text }).first().waitFor();

/** The shipping table the UI test builds, as the API takes it (used to change prices mid-checkout). */
const table = (postTehran: number) => [
  {
    method: "post", enabled: true, freeThresholdToman: 3_000_000, etaMinDays: 3, etaMaxDays: 7,
    rates: [{ provinces: ["تهران"], cities: [], priceToman: postTehran }, { provinces: [], cities: [], priceToman: 150_000 }],
  },
  { method: "tipax", enabled: true, rates: [{ provinces: ["تهران"], cities: [], minWeightGrams: 0, maxWeightGrams: 3000, priceToman: 120_000 }] },
  { method: "local_courier", enabled: true, etaMinDays: 1, etaMaxDays: 1, rates: [{ provinces: ["تهران"], cities: ["تهران"], priceToman: 60_000 }] },
  { method: "pickup", enabled: true, note: "تحویل در گالری، ساعت ۱۰ تا ۱۸" },
];

let adminCtx: BrowserContext;
let admin: Page;
let catalog: Awaited<ReturnType<typeof adminCatalog>>;
let customerCtx: BrowserContext;
let page: Page;
let mug: { id: string; slug: string };
let rug: { id: string; slug: string };
const orders: { post?: number; free?: number; pickup?: number } = {};

async function addToCart(slug: string, extra = 0) {
  await page.goto(`${site.url}/product?slug=${slug}`);
  for (let i = 0; i < extra; i++) await page.getByRole("button", { name: /افزودن تعداد/ }).tap();
  await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
  await pw(page.getByTestId("cart-count")).toBeVisible();
}
async function fillAddress(province: string, city: string) {
  await page.getByLabel(/نام و نام خانوادگی گیرنده/).fill(CUSTOMER.name);
  await page.getByLabel(/شمارهٔ موبایل گیرنده/).fill(CUSTOMER.local);
  await page.getByRole("combobox", { name: /^استان/ }).selectOption(province);
  await page.getByLabel(/^شهر/).fill(city);
  await page.getByLabel(/نشانی کامل/).fill("خیابان ولیعصر، کوچه گل");
  await page.getByLabel(/کد پستی/).fill("1459813176");
}
const feeOf = (method: string) => page.getByTestId(`delivery-${method}-fee`);

describe("shipping and delivery (phones, real PostgreSQL)", () => {
  it("the owner sets up shipping in the real admin screen: validation first, then a full price table that survives a reload", async () => {
    adminCtx = await phone();
    admin = await h.login(adminCtx, h.accounts.owner);
    catalog = await adminCatalog(admin, h.baseUrl);
    const cat = await catalog.category("home", "خانه و دکور");
    mug = await catalog.product({ name: "لیوان سفالی", categoryId: cat, fulfillment: "stocked", priceToman: 300_000, inventory: 30, weightGrams: 400, slug: "clay-mug" }, { tone: [150, 100, 70] });
    rug = await catalog.product({ name: "گلیم بزرگ", categoryId: cat, fulfillment: "stocked", priceToman: 4_000_000, inventory: 5, weightGrams: 4000, slug: "big-kilim" }, { tone: [90, 110, 70] });

    await admin.goto(`${h.baseUrl}/admin/#/shipping`);
    await pw(admin.getByRole("heading", { name: "ارسال و تحویل", level: 1 })).toBeVisible();
    // nothing is on until the owner turns it on
    for (const m of ["post", "tipax", "local_courier", "pickup"]) await pw(admin.getByTestId(`enable-${m}`)).not.toBeChecked();
    await noSideScroll(admin, "shipping (empty)");

    // a method that is switched on but has no price could never deliver: refused with an explanation, nothing saved
    await admin.getByTestId("enable-tipax").check();
    await admin.getByTestId("save-shipping").tap();
    await pw(admin.getByRole("alert").filter({ hasText: "برای روشی که فعال است دست‌کم یک نرخ بنویسید" })).toBeVisible();
    await admin.getByTestId("enable-tipax").uncheck();

    await admin.getByLabel("وزن پیش‌فرض هر عدد (گرم)").fill("500");
    await admin.getByLabel("وزن بسته‌بندی هر سفارش (گرم)").fill("100");

    // post: 3-7 days, free from 3,000,000, Tehran 90,000 and everywhere else 150,000
    const post = admin.getByTestId("method-post");
    await post.getByTestId("enable-post").check();
    await post.getByLabel("زمان تحویل: حداقل (روز)").fill("3");
    await post.getByLabel("زمان تحویل: حداکثر (روز)").fill("7");
    await post.getByLabel(/ارسال رایگان از جمع/).fill("3000000");
    await post.getByTestId("add-rate-post").tap();
    const r0 = admin.getByTestId("rate-post-0");
    await r0.getByLabel("افزودن استان").selectOption("تهران");
    await r0.getByLabel(/^هزینهٔ ارسال/).fill("90000");
    await post.getByTestId("add-rate-post").tap();
    await admin.getByTestId("rate-post-1").getByLabel(/^هزینهٔ ارسال/).fill("150000");

    // tipax: Tehran only, up to 3 kg
    const tipax = admin.getByTestId("method-tipax");
    await tipax.getByTestId("enable-tipax").check();
    await tipax.getByTestId("add-rate-tipax").tap();
    const t0 = admin.getByTestId("rate-tipax-0");
    await t0.getByLabel("افزودن استان").selectOption("تهران");
    await t0.getByLabel("تا وزن (گرم)").fill("3000");
    await t0.getByLabel(/^هزینهٔ ارسال/).fill("120000");

    // local courier: one city
    const courier = admin.getByTestId("method-local_courier");
    await courier.getByTestId("enable-local_courier").check();
    await courier.getByLabel("زمان تحویل: حداقل (روز)").fill("1");
    await courier.getByLabel("زمان تحویل: حداکثر (روز)").fill("1");
    await courier.getByTestId("add-rate-local_courier").tap();
    const c0 = admin.getByTestId("rate-local_courier-0");
    await c0.getByLabel("افزودن استان").selectOption("تهران");
    await c0.getByLabel(/^شهرها/).fill("تهران");
    await c0.getByLabel(/^هزینهٔ ارسال/).fill("60000");

    // pickup: no prices, only a note for the customer
    const pickup = admin.getByTestId("method-pickup");
    await pickup.getByTestId("enable-pickup").check();
    await pickup.getByLabel(/توضیحات برای مشتری/).fill("تحویل در گالری، ساعت ۱۰ تا ۱۸");
    await pw(pickup.getByTestId("add-rate-pickup")).toHaveCount(0);

    // a text where a number belongs is explained on that field, not swallowed
    await post.getByLabel(/ارسال رایگان از جمع/).fill("سه میلیون");
    await admin.getByTestId("save-shipping").tap();
    await pw(post.getByText("مبلغ را فقط با رقم بنویسید.")).toBeVisible();
    await post.getByLabel(/ارسال رایگان از جمع/).fill("3,000,000");

    await shot(admin, "ship-admin");
    await noSideScroll(admin, "shipping (filled)");
    expect(await axeViolations(admin)).toEqual([]);
    await admin.getByTestId("save-shipping").tap();
    await toast(admin, "تنظیمات ارسال ذخیره شد");

    // reload: everything is exactly as saved
    await admin.reload();
    await pw(admin.getByTestId("enable-post")).toBeChecked();
    await pw(admin.getByTestId("method-post").getByLabel(/ارسال رایگان از جمع/)).toHaveValue("۳٬۰۰۰٬۰۰۰");
    await pw(admin.getByTestId("rate-post-0").getByLabel(/^هزینهٔ ارسال/)).toHaveValue("۹۰٬۰۰۰");
    await pw(admin.getByTestId("rate-post-0")).toContainText("تهران");
    await pw(admin.getByTestId("rate-post-1")).toContainText("همهٔ کشور");
    await pw(admin.getByTestId("rate-tipax-0").getByLabel("تا وزن (گرم)")).toHaveValue("3000");
    await pw(admin.getByTestId("method-pickup").getByLabel(/توضیحات برای مشتری/)).toHaveValue("تحویل در گالری، ساعت ۱۰ تا ۱۸");
    await pw(admin.getByLabel("وزن بسته‌بندی هر سفارش (گرم)")).toHaveValue("100");
    expect(sql(`select count(*) from shipping_rates`)).toBe(REAL ? "4" : null);
    expect(sql(`select count(*) from audit_log where action = 'shipping.config'`)).toBe(REAL ? "1" : null);
    // the product weight is part of the product editor
    const products = (await (await admin.request.get(`${h.baseUrl}/api/v1/products/${mug.id}`)).json()) as { product: { weightGrams: number } };
    expect(products.product.weightGrams).toBe(400);
    await admin.goto(`${h.baseUrl}/admin/#/products/${mug.id}`);
    await pw(admin.getByLabel("وزن یک عدد (گرم)")).toHaveValue("400");
  });

  it("checkout: the server's prices appear after the address, per method, destination and weight; the total is exact", async () => {
    customerCtx = await phone();
    page = await customerCtx.newPage();
    await addToCart(mug.slug, 1); // 2 mugs = 600,000 and 800 g (+100 g packaging)
    await page.goto(`${site.url}/checkout`);
    await signInOnCheckout(h, page, CUSTOMER.local, CUSTOMER.e164);
    await pw(page.getByTestId("checkout-shipping-fee")).toHaveText("پس از انتخاب روش ارسال");
    await pw(page.getByTestId("checkout-grand-total")).toHaveText("—");

    // before an address only pickup can be priced
    await pw(page.getByTestId("delivery-pickup")).toBeEnabled({ timeout: 15_000 });
    await pw(page.getByTestId("delivery-post")).toBeDisabled();
    await pw(page.getByTestId("delivery-options")).toContainText("پس از انتخاب استان");

    await fillAddress("تهران", "تهران");
    await pw(feeOf("post")).toHaveText("۹۰٬۰۰۰ تومان", { timeout: 15_000 });
    await pw(feeOf("tipax")).toHaveText("۱۲۰٬۰۰۰ تومان");
    await pw(feeOf("local_courier")).toHaveText("۶۰٬۰۰۰ تومان");
    await pw(feeOf("pickup")).toHaveText("بدون هزینه");
    await pw(page.getByTestId("delivery-options")).toContainText("حدود ۳ تا ۷ روز");
    await pw(page.getByTestId("delivery-options")).toContainText("تحویل در گالری، ساعت ۱۰ تا ۱۸");

    // regression: once priced, the page must not keep asking the server for the same quote
    let quoteCalls = 0;
    const count = (r: { url(): string }) => void (r.url().includes("/shipping/quote") && quoteCalls++);
    page.on("request", count);
    await page.waitForTimeout(2000);
    page.off("request", count);
    expect(quoteCalls).toBe(0);

    // nothing is chosen for the shopper: ordering without a method is refused on the page
    await page.getByTestId("place-order").tap();
    await pw(page.getByTestId("checkout-failure")).toContainText("روش ارسال را انتخاب کنید");

    await page.getByTestId("delivery-post").check();
    await pw(page.getByTestId("checkout-shipping-fee")).toHaveText("۹۰٬۰۰۰ تومان");
    await pw(page.getByTestId("checkout-grand-total")).toHaveText("۶۹۰٬۰۰۰ تومان");
    await shot(page, "ship-checkout");
    await noSideScroll(page, "checkout with delivery");
    expect(await axeViolations(page)).toEqual([]);

    // another destination: the same method now costs the "everywhere else" price, a method that does not go there is explained
    await page.getByRole("combobox", { name: /^استان/ }).selectOption("فارس");
    await page.getByLabel(/^شهر/).fill("شیراز");
    await pw(page.getByTestId("checkout-shipping-fee")).toHaveText("۱۵۰٬۰۰۰ تومان", { timeout: 15_000 });
    await pw(page.getByTestId("checkout-grand-total")).toHaveText("۷۵۰٬۰۰۰ تومان");
    await pw(page.getByTestId("delivery-tipax")).toBeDisabled();
    await pw(page.getByTestId("delivery-local_courier")).toBeDisabled();
    await pw(page.getByTestId("delivery-options")).toContainText("به این نشانی (یا با این وزن) ارسال نمی‌شود");
    // back to Tehran
    await page.getByRole("combobox", { name: /^استان/ }).selectOption("تهران");
    await page.getByLabel(/^شهر/).fill("تهران");
    await pw(page.getByTestId("checkout-shipping-fee")).toHaveText("۹۰٬۰۰۰ تومان", { timeout: 15_000 });
    await pw(page.getByTestId("delivery-tipax")).toBeEnabled();
  });

  it("the owner changes the price while the customer is on the page: the order is refused with the new fee, then goes through", async () => {
    await catalog.shipping(table(95_000), { defaultItemWeightGrams: 500, packagingWeightGrams: 100 });
    await page.getByTestId("place-order").tap();
    await pw(page.getByTestId("checkout-failure")).toContainText("هزینهٔ ارسال تغییر کرده است");
    await pw(page.getByTestId("checkout-shipping-fee")).toHaveText("۹۵٬۰۰۰ تومان");
    await pw(page.getByTestId("checkout-grand-total")).toHaveText("۶۹۵٬۰۰۰ تومان");
    expect(sql(`select count(*) from orders`)).toBe(REAL ? "0" : null);
    expect(sql(`select inventory from products where slug = 'clay-mug'`)).toBe(REAL ? "30" : null); // nothing was reserved by the refusal

    await page.getByTestId("place-order").tap();
    await page.waitForURL(/\/order\?number=\d+/);
    orders.post = Number(/number=(\d+)/.exec(page.url())?.[1]);
    await pw(page.getByTestId("order-subtotal")).toHaveText("۶۰۰٬۰۰۰ تومان");
    await pw(page.getByTestId("order-shipping-fee")).toContainText("۹۵٬۰۰۰ تومان");
    await pw(page.getByTestId("order-total")).toHaveText("۶۹۵٬۰۰۰ تومان");
    await pw(page.getByTestId("delivery-method")).toContainText("پست");
    await pw(page.getByTestId("delivery-method")).toContainText("حدود ۳ تا ۷ روز");
    await pw(page.getByTestId("delivery-details")).toContainText("خیابان ولیعصر");
    await pw(page.getByTestId("delivery-status")).toHaveCount(0); // nothing to say before the gallery confirms
    await shot(page, "ship-order");
    await noSideScroll(page, "order with delivery");
    expect(await axeViolations(page)).toEqual([]);
    if (REAL) {
      expect(sql(`select "totalToman", "subtotalToman", "shippingFeeToman", "deliveryMethod" from orders where number = ${orders.post}`)).toBe("695000|600000|95000|post");
      expect(sql(`select "deliveryDetails"->>'weightGrams' from orders where number = ${orders.post}`)).toBe("900");
      expect(sql(`select inventory from products where slug = 'clay-mug'`)).toBe("28");
    }

    // later price changes never touch an order that exists
    await catalog.shipping(table(111_000), { defaultItemWeightGrams: 500, packagingWeightGrams: 100 });
    await page.reload();
    await pw(page.getByTestId("order-shipping-fee")).toContainText("۹۵٬۰۰۰ تومان");
    await pw(page.getByTestId("order-total")).toHaveText("۶۹۵٬۰۰۰ تومان");
  });

  it("free shipping from the threshold, and a cart too heavy for a method", async () => {
    await addToCart(rug.slug); // 4,000,000 and 4000 g
    await page.goto(`${site.url}/checkout`);
    await page.getByLabel(/نام و نام خانوادگی گیرنده/).waitFor();
    await fillAddress("تهران", "تهران");
    await pw(page.getByTestId("delivery-post")).toBeEnabled({ timeout: 15_000 });
    await pw(feeOf("post")).toHaveText("رایگان");
    await pw(page.getByTestId("delivery-options")).toContainText("ارسال رایگان برای این سفارش");
    await pw(page.getByTestId("delivery-tipax")).toBeDisabled(); // 4100 g is above tipax's 3000 g
    await pw(feeOf("local_courier")).toHaveText("۶۰٬۰۰۰ تومان"); // the courier has no weight limit and no free threshold
    await page.getByTestId("delivery-post").check();
    await pw(page.getByTestId("checkout-grand-total")).toHaveText("۴٬۰۰۰٬۰۰۰ تومان");
    await page.getByTestId("place-order").tap();
    await page.waitForURL(/\/order\?number=\d+/);
    orders.free = Number(/number=(\d+)/.exec(page.url())?.[1]);
    await pw(page.getByTestId("order-shipping-fee")).toContainText("رایگان");
    await pw(page.getByTestId("order-total")).toHaveText("۴٬۰۰۰٬۰۰۰ تومان");
    if (REAL) expect(sql(`select "shippingFeeToman", "deliveryDetails"->>'free' from orders where number = ${orders.free}`)).toBe("0|true");
  });

  it("pickup: no address is asked for or kept, no fee", async () => {
    await addToCart(mug.slug);
    await page.goto(`${site.url}/checkout`);
    await page.getByLabel(/نام و نام خانوادگی گیرنده/).waitFor();
    await page.getByLabel(/نام و نام خانوادگی گیرنده/).fill(CUSTOMER.name);
    await page.getByLabel(/شمارهٔ موبایل گیرنده/).fill(CUSTOMER.local);
    await chooseDelivery(page, "pickup");
    await pw(page.getByTestId("pickup-note")).toBeVisible();
    await pw(page.getByLabel(/نشانی کامل/)).toHaveCount(0);
    await pw(page.getByLabel(/کد پستی/)).toHaveCount(0);
    await pw(page.getByTestId("checkout-shipping-fee")).toHaveText("بدون هزینه");
    await pw(page.getByTestId("checkout-grand-total")).toHaveText("۳۰۰٬۰۰۰ تومان");
    await shot(page, "ship-pickup");
    await noSideScroll(page, "pickup checkout");
    await page.getByTestId("place-order").tap();
    await page.waitForURL(/\/order\?number=\d+/);
    orders.pickup = Number(/number=(\d+)/.exec(page.url())?.[1]);
    await pw(page.getByRole("heading", { name: "تحویل حضوری", level: 2 })).toBeVisible();
    await pw(page.getByTestId("delivery-details")).toContainText(CUSTOMER.name);
    await pw(page.getByTestId("delivery-details")).not.toContainText("کد پستی");
    await pw(page.getByTestId("order-shipping-fee")).toContainText("بدون هزینه");
    if (REAL) expect(sql(`select shipping->>'street' is null, shipping->>'postalCode' is null, "shippingFeeToman" from orders where number = ${orders.pickup}`)).toBe("t|t|0");
  });

  it("the owner sees the delivery of each order, confirms, ships with carrier and tracking; the customer sees them", async () => {
    const o = orders.post as number;
    await admin.goto(`${h.baseUrl}/admin/#/orders/${o}`);
    await pw(admin.getByTestId("order-subtotal")).toHaveText("۶۰۰٬۰۰۰ تومان");
    await pw(admin.getByTestId("order-shipping-fee")).toContainText("۹۵٬۰۰۰ تومان");
    await pw(admin.getByTestId("order-total")).toHaveText("۶۹۵٬۰۰۰ تومان");
    await pw(admin.getByTestId("delivery-method")).toContainText("پست");
    await pw(admin.getByTestId("delivery-method")).toContainText("۹۰۰ گرم");
    await pw(admin.getByRole("main")).toContainText("خیابان ولیعصر");
    await pw(admin.getByTestId("shipment-section")).toHaveCount(0); // nothing to enter before the order is confirmed
    await noSideScroll(admin, "admin order (delivery)");

    const actions = admin.getByTestId("order-actions");
    await actions.getByRole("button", { name: "تأیید سفارش" }).tap();
    await pw(admin.getByText("وضعیت سفارش: تأیید شده").first()).toBeVisible();
    await pw(admin.getByTestId("shipment-section")).toBeVisible();
    await actions.getByRole("button", { name: "شروع آماده‌سازی" }).tap();
    await pw(admin.getByText("وضعیت سفارش: در حال آماده‌سازی").first()).toBeVisible();

    // the customer sees "preparing" and no tracking yet
    await page.goto(`${site.url}/order?number=${o}`);
    await pw(page.getByTestId("delivery-status")).toContainText("در حال آماده‌سازی");
    await pw(page.getByTestId("tracking")).toHaveCount(0);

    // ship: the form asks for the carrier (the customer's method is the default) and a tracking code
    await actions.getByRole("button", { name: "ثبت ارسال" }).tap();
    const form = admin.getByTestId("ship-form");
    await pw(form.getByLabel("حامل", { exact: true })).toHaveValue("post");
    await form.getByLabel("حامل", { exact: true }).selectOption("other");
    await form.getByRole("button", { name: "ثبت ارسال" }).tap();
    await toast(admin, "برای «سایر» نام حامل را بنویسید");
    await form.getByLabel("نام حامل").fill("پیک فروشگاه");
    await form.getByLabel(/کد رهگیری/).fill("PK-2024/778");
    await shot(admin, "ship-form");
    await noSideScroll(admin, "ship form");
    await form.getByRole("button", { name: "ثبت ارسال" }).tap();
    await pw(admin.getByText("وضعیت سفارش: ارسال شده").first()).toBeVisible();
    await pw(admin.getByTestId("shipment-current")).toContainText("پیک فروشگاه");
    await pw(admin.getByTestId("shipment-code")).toHaveText("PK-2024/778");
    expect(sql(`select carrier, "carrierName", "trackingCode" from order_shipments`)).toBe(REAL ? "other|پیک فروشگاه|PK-2024/778" : null);

    await page.reload();
    await pw(page.getByTestId("delivery-status")).toContainText("تحویل حامل شد");
    await pw(page.getByTestId("tracking")).toContainText("پیک فروشگاه");
    await pw(page.getByTestId("tracking-code")).toHaveText("PK-2024/778");
    await shot(page, "ship-tracking");
    await noSideScroll(page, "tracking");

    // a typo is corrected later; the customer sees the corrected code; unsafe text is refused
    const editor = admin.getByTestId("shipment-form");
    await editor.getByLabel(/کد رهگیری/).fill("<b>x</b>");
    await editor.getByRole("button", { name: "اصلاح حامل و کد رهگیری" }).tap();
    await toast(admin, "کد رهگیری یا نام حامل معتبر نیست");
    await editor.getByLabel("حامل", { exact: true }).selectOption("tipax");
    await editor.getByLabel(/کد رهگیری/).fill("TX-5551234");
    await editor.getByRole("button", { name: "اصلاح حامل و کد رهگیری" }).tap();
    await toast(admin, "حامل و کد رهگیری ذخیره شد");
    await pw(admin.getByTestId("shipment-current")).toContainText("تیپاکس");
    await page.reload();
    await pw(page.getByTestId("tracking")).toContainText("تیپاکس");
    await pw(page.getByTestId("tracking-code")).toHaveText("TX-5551234");
    expect(sql(`select count(*) from order_shipments where "orderId" = (select id from orders where number = ${o})`)).toBe(REAL ? "1" : null);

    await actions.getByRole("button", { name: "ثبت تحویل" }).tap();
    await pw(admin.getByText("وضعیت سفارش: تحویل داده شده").first()).toBeVisible();
    await page.reload();
    await pw(page.getByTestId("delivery-status")).toContainText("به دست شما رسید");
    await pw(page.getByTestId("tracking-code")).toHaveText("TX-5551234");
  });

  it("a pickup order is 'ready for pickup' rather than 'shipped', with no tracking code to enter", async () => {
    const o = orders.pickup as number;
    await admin.goto(`${h.baseUrl}/admin/#/orders/${o}`);
    await pw(admin.getByRole("heading", { name: "تحویل حضوری", level: 2 })).toBeVisible();
    await pw(admin.getByRole("main")).not.toContainText("کد پستی");
    const actions = admin.getByTestId("order-actions");
    await actions.getByRole("button", { name: "تأیید سفارش" }).tap();
    await pw(admin.getByText("وضعیت سفارش: تأیید شده").first()).toBeVisible();
    await actions.getByRole("button", { name: "شروع آماده‌سازی" }).tap();
    await pw(admin.getByText("وضعیت سفارش: در حال آماده‌سازی").first()).toBeVisible();
    await actions.getByRole("button", { name: "ثبت ارسال" }).tap();
    const form = admin.getByTestId("ship-form");
    await pw(form.getByLabel("حامل", { exact: true })).toHaveValue("pickup");
    await pw(form.getByLabel(/کد رهگیری/)).toHaveCount(0);
    await form.getByRole("button", { name: "آمادهٔ تحویل حضوری است" }).tap();
    await pw(admin.getByText("وضعیت سفارش: ارسال شده").first()).toBeVisible();
    await page.goto(`${site.url}/order?number=${o}`);
    await pw(page.getByTestId("delivery-status")).toContainText("آمادهٔ تحویل حضوری است");
    await pw(page.getByTestId("tracking-code")).toHaveCount(0);
  });

  it("orders from before shipping existed still read well (no method, fee 0)", async () => {
    // a row as the previous version wrote it: no delivery method, no details, subtotal = total (what the migration gives old rows)
    if (!REAL) return;
    const customerId = sql(`select id from customers limit 1`);
    const productId = sql(`select id from products where slug = 'clay-mug'`);
    const vendorId = sql(`select id from \"Vendor\" limit 1`);
    sql(`insert into orders (id, number, "customerId", status, "totalToman", "subtotalToman", shipping, "placedAt", "updatedAt") values ('legacy-1', 777, '${customerId}', 'pending', 250000, 250000, '{"recipientName":"قدیمی","province":"تهران","city":"تهران","street":"خیابان قدیم ۱","postalCode":"1459813176"}', now(), now())`);
    sql(`insert into order_items (id, "orderId", "productId", "vendorId", "titleSnapshot", "unitPriceToman", quantity) values ('legacy-item', 'legacy-1', '${productId}', '${vendorId}', 'قدیمی', 250000, 1)`);
    await page.goto(`${site.url}/order?number=777`);
    await pw(page.getByTestId("order-total")).toHaveText("۲۵۰٬۰۰۰ تومان");
    await pw(page.getByTestId("order-shipping-fee")).toContainText("ثبت نشده");
    await pw(page.getByTestId("delivery-details")).toContainText("خیابان قدیم");
    await admin.goto(`${h.baseUrl}/admin/#/orders/777`);
    await pw(admin.getByTestId("order-shipping-fee")).toContainText("ثبت نشده");
    await pw(admin.getByTestId("order-total")).toHaveText("۲۵۰٬۰۰۰ تومان");
  });

  it("no request left the local servers (nothing foreign is needed to ship an order)", async () => {
    const foreign = [...hosts].filter((host) => !host.startsWith("127.0.0.1:"));
    expect(foreign).toEqual([]);
    await customerCtx.close();
    await adminCtx.close();
  });
});

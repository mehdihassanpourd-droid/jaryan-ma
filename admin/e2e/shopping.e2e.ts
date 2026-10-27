import { expect as pw } from "playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import type { BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { adminCatalog } from "./admin-api";
import { startHarness, type Harness } from "./harness";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * The customer's whole shopping journey in a real browser on an Android-sized touch screen, against the real server,
 * and (with E2E_DATABASE_URL) real PostgreSQL: product → variant and quantity → cart (changes, persistence, price and
 * availability from the live catalogue) → sign in with an SMS code (the development console provider: the code is read
 * from the server log) → checkout → a REAL pending order → confirmation and history. A second storefront build WITHOUT
 * an order system proves the demo checkout never pretends to place an order.
 */
const ADMIN_PORT = 47832; // baked into the storefront builds (NEXT_PUBLIC_*_URL)
const PHONE_E164 = "+989121234567";
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

let h: Harness;
let withOrders: { dir: string; server: Server; url: string };
let demoOnly: { dir: string; server: Server; url: string };

beforeAll(async () => {
  const catalogUrl = `http://127.0.0.1:${ADMIN_PORT}/media`;
  const a = buildStorefront({ NEXT_PUBLIC_CATALOG_URL: catalogUrl, NEXT_PUBLIC_ORDER_API_URL: `http://127.0.0.1:${ADMIN_PORT}` });
  withOrders = { dir: a, ...(await serveStatic(a)) };
  const b = buildStorefront({ NEXT_PUBLIC_CATALOG_URL: catalogUrl }); // no order system
  demoOnly = { dir: b, ...(await serveStatic(b)) };
  h = await startHarness({ port: ADMIN_PORT, customerOrigins: `${withOrders.url},${demoOnly.url}`, ...(process.env.E2E_DATABASE_URL ? { databaseUrl: process.env.E2E_DATABASE_URL } : {}) });
}, 600_000);
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(80)}`);
});
afterAll(async () => {
  await adminCtx?.close();
  await h?.stop();
  for (const s of [withOrders, demoOnly]) {
    s?.server.closeAllConnections();
    await new Promise((r) => (s ? s.server.close(r) : r(undefined)));
    if (s) rmSync(s.dir, { recursive: true, force: true });
  }
});

const phone = (opts: object = {}) => h.browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR", ...opts });
const noSideScroll = async (page: Page, where: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal scroll on ${where}`).toBeLessThanOrEqual(0);
const shot = async (page: Page, name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }); };
const tall = async (page: Page, locator: ReturnType<Page["locator"]>, what: string) => {
  const box = await locator.boundingBox();
  expect(box?.height ?? 0, `${what} must be a comfortable touch target`).toBeGreaterThanOrEqual(44);
};
async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: Document, o: object): Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}
/** The most recent SMS code the (development) console provider printed for this number. */
async function smsCode(e164: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const matches = [...h.serverLog(400).matchAll(new RegExp(`\\[dev sms\\] to ${e164.replace("+", "\\+")}: [^\\n]*?(\\d{6})`, "g"))];
    const last = matches.at(-1);
    if (last?.[1]) return last[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("no SMS code in the server log");
}
const sql = (query: string) => {
  if (!process.env.E2E_DATABASE_URL) return null;
  return execFileSync("psql", [process.env.E2E_DATABASE_URL, "-At", "-c", query], { encoding: "utf8" }).trim();
};

let rug: { id: string; slug: string };
let cushion: { id: string; slug: string };
let runner: { id: string; slug: string };
let catalog: Awaited<ReturnType<typeof adminCatalog>>;
let adminCtx: BrowserContext;
let adminPage: Page;

describe("customer shopping journey, start to finish, on a phone", () => {
  it("prepares the catalogue through the admin (published, sold-out variant, made-to-order, draft)", async () => {
    adminCtx = await phone();
    const admin = await h.login(adminCtx, h.accounts.owner);
    adminPage = admin;
    catalog = await adminCatalog(admin, h.baseUrl);
    const cat = await catalog.category("wall", "تابلو و بافته");
    rug = await catalog.product({ name: "تابلو گلیم کوهستان", description: "تابلوی بافته‌شده با دست.", categoryId: cat, fulfillment: "unique", priceToman: 4_500_000, inventory: 1, slug: "kuhestan-rug" });
    cushion = await catalog.product({
      name: "کوسن بافته", categoryId: cat, fulfillment: "stocked", priceToman: 500_000, slug: "woven-cushion",
      variants: [
        { sku: "CU-S", options: { اندازه: "کوچک" }, priceToman: 500_000, inventory: 5 },
        { sku: "CU-L", options: { اندازه: "بزرگ" }, priceToman: 800_000, inventory: 0 },
        { sku: "CU-M", options: { اندازه: "متوسط" }, priceToman: 650_000, inventory: 4 },
      ],
    }, { tone: [90, 110, 70] });
    runner = await catalog.product({ name: "رانر سفارشی", categoryId: cat, fulfillment: "made_to_order", priceToman: 2_000_000, leadTimeDays: 21, slug: "custom-runner" }, { tone: [140, 100, 120] });
    await catalog.product({ name: "محصول پیش‌نویس", categoryId: cat, fulfillment: "unique", priceToman: 1_000_000, inventory: 1, slug: "hidden-draft" }, { status: "draft" });
  });

  it("variant + quantity → cart: exact totals, changes, removal, and the cart survives a reload", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    await page.goto(`${withOrders.url}/`);
    await pw(page.getByTestId("live-products").getByRole("link", { name: "کوسن بافته" })).toBeVisible({ timeout: 15_000 });
    await pw(page.getByTestId("live-products").getByRole("link", { name: "محصول پیش‌نویس" })).toHaveCount(0); // a draft never shows
    await pw(page.getByTestId("cart-count")).toHaveCount(0);

    // product with variants: the sold-out size cannot be chosen; pick the middle size, two of them
    await page.goto(`${withOrders.url}/product?slug=${cushion.slug}`);
    const sizes = page.getByRole("region", { name: "گزینه‌ها" });
    await pw(sizes.getByRole("radio", { name: /بزرگ/ })).toBeDisabled();
    await pw(sizes.getByRole("radio", { name: /کوچک/ })).toBeChecked(); // first size that can be bought
    await sizes.getByRole("radio", { name: /متوسط/ }).check();
    await pw(page.getByText("قیمت گزینهٔ انتخاب‌شده:")).toContainText("۶۵۰٬۰۰۰ تومان");
    await page.getByRole("button", { name: /افزودن تعداد/ }).tap();
    await pw(page.getByTestId("quantity")).toHaveText("۲");
    const addButton = page.getByRole("button", { name: "افزودن به سبد خرید" });
    await tall(page, addButton, "add to cart");
    await addButton.tap();
    await pw(page.getByRole("status").filter({ hasText: "به سبد اضافه شد" })).toBeVisible();
    await pw(page.getByTestId("cart-count")).toHaveText("۲");
    await noSideScroll(page, "product page");
    await shot(page, "shop-product");

    // a unique piece: no quantity control, one only; and made-to-order shows its lead time
    await page.goto(`${withOrders.url}/product?slug=${rug.slug}`);
    await pw(page.getByText("اثر یگانه: فقط یک عدد")).toBeVisible();
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await pw(page.getByRole("button", { name: "افزودن به سبد خرید" })).toBeDisabled(); // a unique piece is in the cart once, not twice
    await pw(page.getByText("این اثر در سبد خرید شما هست.")).toBeVisible();
    await page.goto(`${withOrders.url}/product?slug=${runner.slug}`);
    await pw(page.getByText("زمان ساخت: ۲۱ روز")).toBeVisible();
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();

    // the cart: exact prices and total from the live catalogue
    await page.goto(`${withOrders.url}/cart`);
    const lines = page.getByTestId("cart-line");
    await pw(lines).toHaveCount(3);
    await pw(page.getByTestId("cart-total")).toHaveText("۷٬۸۰۰٬۰۰۰ تومان"); // 2×650k + 4.5M + 2M
    await pw(lines.filter({ hasText: "کوسن بافته" }).getByTestId("line-total")).toHaveText("۱٬۳۰۰٬۰۰۰ تومان");
    await pw(lines.filter({ hasText: "متوسط" })).toHaveCount(1);
    await pw(lines.filter({ hasText: "رانر سفارشی" })).toContainText("ساخت پس از سفارش (حدود ۲۱ روز)");
    await pw(page.getByText("هزینهٔ ارسال در این مبلغ لحاظ نشده است.")).toBeVisible();
    await pw(page.getByText("پرداخت آنلاین هنوز فعال نیست")).toBeVisible();

    // change quantity (+) and remove a line; totals follow exactly
    const cushionLine = lines.filter({ hasText: "کوسن بافته" });
    await cushionLine.getByRole("button", { name: /افزودن تعداد/ }).tap();
    await pw(cushionLine.getByTestId("line-total")).toHaveText("۱٬۹۵۰٬۰۰۰ تومان");
    await pw(page.getByTestId("cart-total")).toHaveText("۸٬۴۵۰٬۰۰۰ تومان");
    await tall(page, cushionLine.getByRole("button", { name: /کم کردن تعداد/ }), "quantity −");
    await lines.filter({ hasText: "رانر سفارشی" }).getByRole("button", { name: /حذف/ }).tap();
    await pw(lines).toHaveCount(2);
    await pw(page.getByTestId("cart-total")).toHaveText("۶٬۴۵۰٬۰۰۰ تومان");
    await pw(page.getByTestId("cart-count")).toHaveText("۴");

    // reload: the same cart, the same numbers (it lives in the browser, prices re-read from the catalogue)
    await page.reload();
    await pw(page.getByTestId("cart-line")).toHaveCount(2);
    await pw(page.getByTestId("cart-total")).toHaveText("۶٬۴۵۰٬۰۰۰ تومان");
    await pw(page.getByTestId("cart-count")).toHaveText("۴");
    await noSideScroll(page, "cart");
    await shot(page, "shop-cart");
    expect(await axeViolations(page)).toEqual([]);

    // what the page stores: product/variant/quantity only; never a price, name or personal detail
    const stored = await page.evaluate(() => window.localStorage.getItem("jm-cart-v1"));
    expect(JSON.parse(stored ?? "[]")).toEqual(expect.arrayContaining([{ slug: cushion.slug, sku: "CU-M", quantity: 3 }, { slug: rug.slug, sku: null, quantity: 1 }]));
    expect(stored).not.toMatch(/priceToman|name|1950000|4500000/);

    // a stale cart is refused item by item: the rug is sold elsewhere while it sits in the cart
    await catalog.setStock(rug.id, 0);
    await page.reload();
    await pw(page.getByTestId("cart-line").filter({ hasText: "تابلو گلیم کوهستان" }).getByTestId("line-problem")).toHaveText("ناموجود شده است.", { timeout: 15_000 });
    await pw(page.getByTestId("cart-total")).toHaveText("۱٬۹۵۰٬۰۰۰ تومان"); // the sold-out piece is not counted
    await page.getByTestId("cart-line").filter({ hasText: "تابلو گلیم کوهستان" }).getByRole("button", { name: /حذف/ }).tap();
    await pw(page.getByTestId("cart-line")).toHaveCount(1);
    expect(problems).toEqual([]);
    await ctx.close();
  });

  it("checkout: sign in with an SMS code, validate the form, place a REAL pending order, see it confirmed and in history", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => m.type() === "error" && !/status of (401|409|422)|Failed to load resource/.test(m.text()) && problems.push(m.text()));

    // build a cart the way a shopper does
    await page.goto(`${withOrders.url}/product?slug=${cushion.slug}`);
    await page.getByRole("region", { name: "گزینه‌ها" }).getByRole("radio", { name: /متوسط/ }).check();
    await page.getByRole("button", { name: /افزودن تعداد/ }).tap();
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await pw(page.getByTestId("cart-count")).toHaveText("۲");

    await page.goto(`${withOrders.url}/checkout`);
    await pw(page.getByText("سفارش شما با وضعیت «در انتظار تأیید» ثبت می‌شود.")).toBeVisible();
    await pw(page.getByTestId("demo-banner")).toHaveCount(0);
    await pw(page.getByTestId("checkout-total")).toHaveText("۱٬۳۰۰٬۰۰۰ تومان");
    // signed out: the form is not even shown; the only way in is the SMS code
    await pw(page.getByTestId("shipping-form")).toHaveCount(0);
    await pw(page.getByRole("heading", { name: "ورود با کد پیامکی" })).toBeVisible();

    await page.getByLabel(/شمارهٔ موبایل/).fill("123");
    await page.getByRole("button", { name: "دریافت کد" }).tap();
    await pw(page.getByRole("alert").first()).toContainText("شمارهٔ موبایل معتبر نیست");
    await page.getByLabel(/شمارهٔ موبایل/).fill("۰۹۱۲۱۲۳۴۵۶۷"); // Persian digits are fine
    await page.getByRole("button", { name: "دریافت کد" }).tap();
    await page.getByLabel(/کد تأیید/).fill("000000");
    await page.getByRole("button", { name: "تأیید و ورود" }).tap();
    await pw(page.getByRole("alert").first()).toContainText("کد نادرست یا منقضی");
    await page.getByLabel(/کد تأیید/).fill(await smsCode(PHONE_E164));
    await page.getByRole("button", { name: "تأیید و ورود" }).tap();
    // a brand-new number must accept the terms before the account exists
    await pw(page.getByRole("alert").first()).toContainText("پذیرفتن شرایط");
    await page.getByRole("checkbox", { name: /شرایط استفاده/ }).check();
    await page.getByRole("button", { name: "تأیید و ورود" }).tap();
    await shot(page, "shop-signin");
    await pw(page.getByTestId("shipping-form")).toBeVisible();
    await pw(page.getByText(`وارد شده‌اید با`)).toContainText(PHONE_E164);

    // the form: empty -> each field explains itself, nothing is sent
    const place = page.getByTestId("place-order");
    await tall(page, place, "place order");
    await place.tap();
    for (const message of ["نام و نام خانوادگی گیرنده را بنویسید", "شمارهٔ موبایل معتبر نیست", "استان را انتخاب کنید", "شهر را بنویسید", "نشانی کامل را بنویسید", "کد پستی ۱۰ رقمی معتبر نیست"]) {
      await pw(page.getByText(message).first()).toBeVisible();
    }
    expect(sql("select count(*) from orders")).toBe(process.env.E2E_DATABASE_URL ? "0" : null);

    await page.getByLabel(/نام و نام خانوادگی گیرنده/).fill("علی رضایی");
    await page.getByLabel(/شمارهٔ موبایل گیرنده/).fill("۰۹۱۲۱۲۳۴۵۶۷");
    await page.getByLabel(/استان/).selectOption("تهران");
    await page.getByLabel(/^شهر/).fill("تهران");
    await page.getByLabel(/نشانی کامل/).fill("خیابان ولیعصر، کوچه گل");
    await page.getByLabel(/^پلاک/).fill("۱۲");
    await page.getByLabel(/^واحد/).fill("۳");
    await page.getByLabel(/کد پستی/).fill("۱۴۵۹۸۱۳۱۷۶");
    await page.getByLabel(/توضیحات سفارش/).fill("لطفاً بسته‌بندی هدیه");
    await page.getByRole("checkbox", { name: /نشانی در حساب من ذخیره شود/ }).check();
    // every field was filled in: none of the earlier "required" messages may still be on screen
    await pw(page.getByTestId("shipping-form").getByRole("alert")).toHaveCount(0);
    await noSideScroll(page, "checkout");
    await shot(page, "shop-checkout");
    expect(await axeViolations(page)).toEqual([]);

    // a double tap places ONE order
    await place.dblclick();
    await page.waitForURL(/\/order\?number=\d+/);
    await pw(page.getByTestId("order-detail")).toBeVisible();
    await pw(page.getByRole("heading", { level: 1 })).toContainText("JM-100001");
    await pw(page.getByTestId("order-status")).toHaveText("در انتظار تأیید");
    await pw(page.getByTestId("order-total")).toHaveText("۱٬۳۰۰٬۰۰۰ تومان");
    await pw(page.getByTestId("order-detail")).toContainText("کوسن بافته");
    await pw(page.getByTestId("order-detail")).toContainText("متوسط");
    await pw(page.getByTestId("order-detail")).toContainText("علی رضایی");
    await pw(page.getByTestId("order-detail")).toContainText("1459813176");
    await pw(page.getByText("هیچ مبلغی از شما دریافت نمی‌شود.")).toBeVisible();
    expect(await page.getByTestId("order-detail").locator("img").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await noSideScroll(page, "order confirmation");
    await shot(page, "shop-confirmation");
    await pw(page.getByTestId("cart-count")).toHaveCount(0); // the cart was emptied by the order
    expect(await page.evaluate(() => window.localStorage.getItem("jm-cart-v1"))).toBe("[]");

    // the order is a real row: pending, exact total, vendor on the line; stock untouched; nothing about payment exists
    if (process.env.E2E_DATABASE_URL) {
      expect(sql(`select count(*) from orders`)).toBe("1");
      expect(sql(`select status, "totalToman" from orders`)).toBe("pending|1300000");
      expect(sql(`select "skuSnapshot", quantity, "unitPriceToman", ("vendorId" is not null) from order_items`)).toBe("CU-M|2|650000|t");
      expect(sql(`select inventory from product_variants where sku = 'CU-M'`)).toBe("4");
      expect(sql(`select count(*) from information_schema.columns where table_name = 'orders' and column_name ilike '%pay%'`)).toBe("0");
      expect(sql(`select count(*) from addresses`)).toBe("1");
    }

    // history: signed in on reload too (the cookie), newest first, opens the order
    await page.goto(`${withOrders.url}/orders`);
    const list = page.getByTestId("orders-list");
    await pw(list.getByRole("link")).toHaveCount(1);
    await pw(list).toContainText("JM-100001");
    await pw(list).toContainText("در انتظار تأیید");
    await pw(list).toContainText("۱٬۳۰۰٬۰۰۰ تومان");
    await noSideScroll(page, "order history");
    await list.getByRole("link").tap();
    await pw(page.getByTestId("order-detail")).toBeVisible();

    // a second order: still signed in, the saved address fills the form, and stock vanishes while the page is open
    await page.goto(`${withOrders.url}/product?slug=${cushion.slug}`);
    await page.getByRole("region", { name: "گزینه‌ها" }).getByRole("radio", { name: /متوسط/ }).check();
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await page.goto(`${withOrders.url}/product?slug=${runner.slug}`);
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await page.goto(`${withOrders.url}/checkout`);
    await pw(page.getByLabel(/نام و نام خانوادگی گیرنده/)).toHaveValue("علی رضایی", { timeout: 15_000 });
    await pw(page.getByLabel(/کد پستی/)).toHaveValue("1459813176");
    await pw(page.getByTestId("checkout-total")).toHaveText("۲٬۶۵۰٬۰۰۰ تومان");
    await catalog.setStock(cushion.id, 0, "CU-M"); // the cushion is sold out while the checkout page is open (it still shows it)
    await page.getByTestId("place-order").tap();
    await pw(page.getByTestId("checkout-failure")).toContainText("سفارش ثبت نشد");
    await pw(page.getByTestId("summary-lines").getByRole("alert")).toContainText("ناموجود شده است");
    if (process.env.E2E_DATABASE_URL) expect(sql(`select count(*) from orders`)).toBe("1"); // the server refused: nothing was created

    // the page re-read the catalogue: the sold-out line is out of the order and the total is exact; ordering what remains works
    await pw(page.getByTestId("checkout-total")).toHaveText("۲٬۰۰۰٬۰۰۰ تومان", { timeout: 15_000 });
    await page.getByTestId("place-order").tap();
    await page.waitForURL(/\/order\?number=2/);
    await pw(page.getByRole("heading", { level: 1 })).toContainText("JM-100002");
    await pw(page.getByTestId("order-detail")).toContainText("رانر سفارشی");
    await pw(page.getByTestId("order-detail")).not.toContainText("کوسن بافته");
    await pw(page.getByTestId("order-total")).toHaveText("۲٬۰۰۰٬۰۰۰ تومان");
    if (process.env.E2E_DATABASE_URL) {
      expect(sql(`select count(*) from orders`)).toBe("2");
      expect(sql(`select status, "totalToman" from orders where number = 2`)).toBe("pending|2000000");
    }
    await page.goto(`${withOrders.url}/orders`);
    await pw(page.getByTestId("orders-list").getByRole("link")).toHaveCount(2);
    await pw(page.getByTestId("orders-list").getByRole("link").first()).toContainText("JM-100002"); // newest first
    expect(problems).toEqual([]);
    await ctx.close();
  });

  it("the owner sees the real orders in the admin, pending on top, with who ordered what and where it goes", async () => {
    const admin = adminPage;
    await admin.goto(`${h.baseUrl}/admin/#/orders`);
    await pw(admin.getByRole("heading", { name: "سفارش‌ها", level: 1 })).toBeVisible();
    await pw(admin.getByTestId("pending-heading")).toContainText("۲ سفارش در انتظار تصمیم شماست");
    const list = admin.getByRole("list", { name: "فهرست سفارش‌ها" });
    await pw(list.getByRole("listitem")).toHaveCount(2);
    await pw(list.getByRole("listitem").first()).toContainText("JM-100002"); // newest first
    await pw(list.getByRole("listitem").first()).toContainText("در انتظار تأیید");
    await pw(list.getByRole("listitem").nth(1)).toContainText("۱٬۳۰۰٬۰۰۰ تومان");
    await noSideScroll(admin, "admin orders");
    await admin.getByLabel("وضعیت").selectOption("delivered");
    await pw(admin.getByText("سفارشی با این وضعیت نیست")).toBeVisible();
    await admin.getByLabel("وضعیت").selectOption("");
    await list.getByRole("listitem").nth(1).getByRole("link", { name: "JM-100001" }).click();
    await pw(admin.getByRole("heading", { name: "سفارش JM-100001" })).toBeVisible();
    await pw(admin.getByRole("main")).toContainText("کوسن بافته");
    await pw(admin.getByRole("main")).toContainText("متوسط");
    await pw(admin.getByRole("main")).toContainText("CU-M");
    await pw(admin.getByRole("main")).toContainText("۲ × ۶۵۰٬۰۰۰ تومان");
    await pw(admin.getByRole("main")).toContainText("علی رضایی");
    await pw(admin.getByRole("main")).toContainText(PHONE_E164);
    await pw(admin.getByRole("main")).toContainText("خیابان ولیعصر، کوچه گل");
    await pw(admin.getByRole("main")).toContainText("1459813176");
    await pw(admin.getByRole("main")).toContainText("لطفاً بسته‌بندی هدیه");
    await noSideScroll(admin, "admin order detail");
    expect(await axeViolations(admin)).toEqual([]);
    await admin.goto(`${h.baseUrl}/admin/#/orders/abc`);
    await pw(admin.getByText("شمارهٔ سفارش معتبر نیست")).toBeVisible();
    await admin.goto(`${h.baseUrl}/admin/#/orders/9999`);
    await pw(admin.getByText(/not_found|پیدا نشد/).first()).toBeVisible();
  });

  it("DEMO checkout (a build with no order system): fully usable, but it never creates or pretends to create an order", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const apiCalls: string[] = [];
    page.on("request", (r) => r.url().startsWith(`http://127.0.0.1:${ADMIN_PORT}/api/`) && apiCalls.push(`${r.method()} ${new URL(r.url()).pathname}`));
    await catalog.setStock(cushion.id, 3, "CU-M");

    await page.goto(`${demoOnly.url}/product?slug=${runner.slug}`);
    await page.getByRole("button", { name: "افزودن به سبد خرید" }).tap();
    await page.goto(`${demoOnly.url}/checkout`);
    await pw(page.getByTestId("demo-banner")).toContainText("هیچ سفارشی ثبت نمی‌شود");
    await pw(page.getByRole("heading", { name: "ورود با کد پیامکی" })).toHaveCount(0);
    await pw(page.getByTestId("place-order")).toHaveCount(0); // there is no "place order" button to press

    await page.getByTestId("make-text").tap(); // empty form: explained, no text
    await pw(page.getByText("نام و نام خانوادگی گیرنده را بنویسید").first()).toBeVisible();
    await pw(page.getByTestId("order-text")).toHaveCount(0);
    await page.getByLabel(/نام و نام خانوادگی گیرنده/).fill("علی رضایی");
    await page.getByLabel(/شمارهٔ موبایل گیرنده/).fill("09121234567");
    await page.getByLabel(/استان/).selectOption("تهران");
    await page.getByLabel(/^شهر/).fill("تهران");
    await page.getByLabel(/نشانی کامل/).fill("خیابان ولیعصر، کوچه گل");
    await page.getByLabel(/کد پستی/).fill("1459813176");
    await page.getByTestId("make-text").tap();
    const preview = page.getByTestId("order-text");
    await pw(preview.getByRole("heading")).toHaveText("پیش‌نمایش سفارش (ثبت نشده)");
    await pw(preview).toContainText("این یک سفارش ثبت‌شده نیست.");
    await pw(preview.getByLabel("متن سفارش")).toHaveValue(/رانر سفارشی — 1 عدد|رانر سفارشی — ۱ عدد/);
    await pw(preview.getByLabel("متن سفارش")).toHaveValue(/جمع کالاها: ۲٬۰۰۰٬۰۰۰ تومان \(هزینهٔ ارسال لحاظ نشده\)/);
    await pw(preview.getByRole("link", { name: "باز کردن اینستاگرام گالری" })).toHaveAttribute("href", /instagram\.com/);
    expect(await page.evaluate(() => window.localStorage.getItem("jm-cart-v1"))).toContain("custom-runner"); // the cart is untouched
    expect(page.url()).toContain("/checkout"); // no confirmation page, no order number anywhere
    await pw(page.getByText(/JM-\d+/)).toHaveCount(0);

    // no order history either; and no write ever reached the server
    await page.goto(`${demoOnly.url}/orders`);
    await pw(page.getByText("هنوز به سامانهٔ ثبت سفارش متصل نیست")).toBeVisible();
    expect(apiCalls.filter((c) => !c.startsWith("GET /media"))).toEqual([]);
    if (process.env.E2E_DATABASE_URL) expect(sql(`select count(*) from orders`)).toBe("2"); // still only the two real orders from before
    await noSideScroll(page, "demo checkout");
    await page.goto(`${demoOnly.url}/checkout`);
    await page.getByTestId("make-text").tap();
    await shot(page, "shop-demo");
    await ctx.close();
  });
});

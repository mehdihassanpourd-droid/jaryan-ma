import { expect as pw } from "playwright/test";
import { rmSync } from "node:fs";
import type { Server } from "node:http";
import type { BrowserContext, Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type Harness } from "./harness";
import { buildStorefront, serveStatic } from "./storefront";
import { solidPng } from "./png";

/**
 * The publishing pipeline, end to end, with nothing mocked: a store owner uses the real admin UI (real server, and a
 * real PostgreSQL when E2E_DATABASE_URL is set); the real STATIC storefront (`npm run build`, the same `out/` that
 * Cloudflare Pages serves, served here by a plain static file server with Pages' extensionless-URL behaviour) is open
 * in a customer's browser. Publishing, editing, unpublishing and archiving must reach the customer WITHOUT rebuilding
 * or redeploying the storefront.
 */
const ADMIN_PORT = 47831; // baked into the storefront build below (NEXT_PUBLIC_CATALOG_URL)
const SLUG = "kuhestan-wall-hanging";
const NAME = "تابلو دیواری گلیم طرح کوهستان";

let h: Harness;
let site: { dir: string; server: Server; url: string };

beforeAll(async () => {
  // The storefront is built ONCE, before anything is published: later changes must not need another build.
  const dir = buildStorefront({ NEXT_PUBLIC_CATALOG_URL: `http://127.0.0.1:${ADMIN_PORT}/media` }); // the live catalogue alone, nothing baked in at build time
  site = { dir, ...(await serveStatic(dir)) };
  h = await startHarness({ port: ADMIN_PORT, ...(process.env.E2E_DATABASE_URL ? { databaseUrl: process.env.E2E_DATABASE_URL } : {}) });
}, 400_000);
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(60)}`);
});
afterAll(async () => {
  await h?.stop();
  site?.server.closeAllConnections();
  await new Promise((r) => (site ? site.server.close(r) : r(undefined)));
  if (site) rmSync(site.dir, { recursive: true, force: true });
});

const toast = (page: Page, text: string | RegExp) => page.locator(".toast", { hasText: text }).first().waitFor();
const phone = (h2: Harness, opts: object = {}) => h2.browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR", ...opts });

/** Reloads the customer's page until `check` passes: the snapshot is written in the background and cached for up to a minute. */
async function eventually(page: Page, check: () => Promise<void>, what: string) {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(500);
      await page.reload();
    }
  }
  throw new Error(`customer never saw: ${what}\n${String(last)}`);
}

describe("admin publish → public storefront, no deployment", () => {
  it("draft never shows; publish, edit (variants, stock), unpublish and archive all reach the customer", async () => {
    const customerCtx: BrowserContext = await phone(h);
    const problems: string[] = [];
    customerCtx.on("page", (p) => {
      p.on("pageerror", (e) => problems.push(e.message));
      p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && problems.push(m.text()));
    });
    const customer = await customerCtx.newPage();
    const home = () => customer.goto(`${site.url}/`);
    const productUrl = `${site.url}/product?slug=${SLUG}`;

    // 0. nothing published yet: an honest empty state, no sample products in the product section
    await home();
    await pw(customer.locator("#featured").getByText("هنوز محصولی منتشر نشده است.")).toBeVisible();
    await pw(customer.locator("#featured")).not.toContainText("نمونه");
    await pw(customer.locator("#collections")).toHaveCount(0);

    // 1. the owner prepares a DRAFT in the real admin UI (category, price, stock, a real image)
    const admin = await h.login(await phone(h), h.accounts.owner);
    await admin.goto(`${h.baseUrl}/admin/#/categories`);
    await admin.getByLabel(/^نام/).fill("تابلو دیواری");
    await admin.getByLabel(/نشانی \(انگلیسی\)/).fill("wall-hanging");
    await admin.getByRole("button", { name: "ساخت دسته‌بندی" }).click();
    await toast(admin, "دسته‌بندی ساخته شد");

    await admin.goto(`${h.baseUrl}/admin/#/products/new`);
    await admin.getByLabel(/^نام محصول/).fill(NAME);
    await admin.getByLabel("توضیحات").fill("تابلوی دیواری بافته‌شده با دست. محصول آزمایشی.");
    await admin.getByLabel("دسته‌بندی").selectOption({ label: "تابلو دیواری" });
    await admin.getByLabel("قیمت (تومان)").fill("4500000");
    await admin.getByLabel("نشانی (اسلاگ)").fill(SLUG);
    await admin.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await toast(admin, "محصول ذخیره شد");
    await admin.getByRole("tab", { name: "تصاویر" }).click();
    await admin.locator('input[type="file"][multiple]').setInputFiles({ name: "kuhestan.png", mimeType: "image/png", buffer: solidPng(900, 1100, [176, 132, 92]) });
    await admin.locator(".image-item").first().waitFor();
    await admin.getByLabel("متن جایگزین (توصیف تصویر)").first().fill("تابلو دیواری گلیم با طرح کوهستان");
    await admin.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await toast(admin, "تغییرات ذخیره شد");

    // 2. a draft is invisible: not in the product list, no product page, and no public file exists for it
    await home();
    await pw(customer.locator("#featured").getByText("هنوز محصولی منتشر نشده است.")).toBeVisible();
    await customer.goto(productUrl);
    await pw(customer.getByText("این محصول در حال حاضر در فروشگاه نیست.")).toBeVisible();
    expect((await fetch(`${h.baseUrl}/media/catalog/products/${SLUG}.json`)).status).toBe(404);

    // 3. publish: the storefront shows it with its real image and price, with NO rebuild
    await admin.getByRole("button", { name: "ذخیره و انتشار" }).click();
    await toast(admin, "منتشر شد");
    await home();
    await eventually(customer, async () => {
      await pw(customer.getByTestId("live-products").getByRole("link", { name: NAME })).toBeVisible({ timeout: 1000 });
    }, "the published product on the home page");
    const card = customer.getByTestId("live-products").getByRole("link", { name: NAME });
    await pw(card).toContainText("۴٬۵۰۰٬۰۰۰ تومان");
    await pw(card).toContainText("اثر یگانه");
    expect(await card.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await card.click();
    await pw(customer.getByRole("heading", { level: 1, name: NAME })).toBeVisible();
    await pw(customer.getByTestId("live-product")).toContainText("بافته‌شده با دست");
    await pw(customer.getByTestId("live-product")).toContainText("۴٬۵۰۰٬۰۰۰ تومان");
    await pw(customer.getByTestId("live-product")).toContainText("موجود");
    await pw(customer.getByTestId("live-product").getByRole("img", { name: "تابلو دیواری گلیم با طرح کوهستان" })).toBeVisible();
    expect(await customer.getByTestId("live-product").locator("img").first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    expect(await customer.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

    // the public file carries published data only: no id, status, stock count, version
    const published = (await (await fetch(`${h.baseUrl}/media/catalog/products/${SLUG}.json`)).json()) as Record<string, unknown>;
    for (const internal of ["id", "status", "inventory", "version", "vendorId", "createdAt", "updatedAt"]) expect(published, internal).not.toHaveProperty(internal);

    // 4. edit the published product: stocked, two sizes, one sold out; new price. The customer sees it all.
    await admin.getByRole("tab", { name: "اطلاعات" }).click();
    await admin.getByLabel("نوع تحویل").selectOption("stocked");
    await admin.getByRole("tab", { name: "گونه‌ها" }).click();
    await admin.getByRole("button", { name: "افزودن گونه" }).click();
    await admin.getByRole("button", { name: "افزودن گونه" }).click();
    const cards = admin.locator(".variant-card");
    const fill = async (i: number, size: string, sku: string, price: string, stock: string) => {
      await cards.nth(i).getByLabel("اندازه").fill(size);
      await cards.nth(i).getByLabel(/^کد کالا/).fill(sku);
      await cards.nth(i).getByLabel("قیمت (تومان)").fill(price);
      await cards.nth(i).getByLabel("موجودی").fill(stock);
    };
    await fill(0, "۵۰×۷۰", "KUH-50X70", "4500000", "3");
    await fill(1, "۷۰×۱۰۰", "KUH-70X100", "6800000", "0");
    await admin.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await toast(admin, "تغییرات ذخیره");
    await customer.goto(productUrl);
    await eventually(customer, async () => {
      await pw(customer.getByRole("region", { name: "گزینه‌ها" }).getByRole("listitem")).toHaveCount(2, { timeout: 1000 });
    }, "the variants");
    const variants = customer.getByRole("region", { name: "گزینه‌ها" }).getByRole("listitem");
    await pw(variants.nth(0)).toContainText("۴٬۵۰۰٬۰۰۰ تومان");
    await pw(variants.nth(0)).toContainText("موجود");
    await pw(variants.nth(1)).toContainText("۶٬۸۰۰٬۰۰۰ تومان");
    await pw(variants.nth(1)).toContainText("ناموجود");
    await pw(customer.getByTestId("live-product")).toContainText("از");

    // 5. back to draft: gone from the home page and from its own page
    await admin.getByRole("button", { name: "برگرداندن به پیش‌نویس" }).click();
    await toast(admin, "تغییرات ذخیره شد");
    await home();
    await eventually(customer, async () => {
      await pw(customer.locator("#featured").getByText("هنوز محصولی منتشر نشده است.")).toBeVisible({ timeout: 1000 });
    }, "the draft to disappear from the home page");
    await customer.goto(productUrl);
    await pw(customer.getByText("این محصول در حال حاضر در فروشگاه نیست.")).toBeVisible();
    expect((await fetch(`${h.baseUrl}/media/catalog/products/${SLUG}.json`)).status).toBe(404);

    // 6. published again, then ARCHIVED: gone again
    await admin.getByRole("button", { name: "ایجاد و انتشار" }).or(admin.getByRole("button", { name: "ذخیره و انتشار" })).click();
    await toast(admin, "منتشر شد");
    await home();
    await eventually(customer, async () => {
      await pw(customer.getByTestId("live-products").getByRole("link", { name: NAME })).toBeVisible({ timeout: 1000 });
    }, "the product published again");
    await admin.getByRole("button", { name: "بایگانی" }).first().click();
    await admin.getByRole("dialog").getByRole("button", { name: "بایگانی" }).click();
    await toast(admin, "تغییرات ذخیره شد");
    await eventually(customer, async () => {
      await pw(customer.locator("#featured").getByText("هنوز محصولی منتشر نشده است.")).toBeVisible({ timeout: 1000 });
    }, "the archived product to disappear");
    await customer.goto(productUrl);
    await pw(customer.getByText("این محصول در حال حاضر در فروشگاه نیست.")).toBeVisible();

    expect(problems).toEqual([]);
    await customerCtx.close();
  });

  it("an unreachable catalogue is said plainly (never a blank page or sample products), and a bad slug is just 'not found'", async () => {
    const ctx = await phone(h);
    const page = await ctx.newPage();
    await page.route("**/media/catalog/**", (route) => route.abort());
    await page.goto(`${site.url}/`);
    await pw(page.locator("#featured").getByRole("alert")).toContainText("دریافت محصولات ممکن نیست");
    await pw(page.locator("#featured")).not.toContainText("نمونه");
    await page.goto(`${site.url}/product?slug=${encodeURIComponent("../manifest")}`);
    await pw(page.getByText("این محصول پیدا نشد.")).toBeVisible();
    await ctx.close();
  });
});

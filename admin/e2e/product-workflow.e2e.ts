import { expect as pw } from "playwright/test";
import { execFileSync } from "node:child_process";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { totpAt, totpStep } from "../../server/auth/totp";
import { startHarness, type Harness } from "./harness";
import { solidPng } from "./png";

/**
 * The whole store-owner workflow in the real admin UI on an Android-sized touch viewport, against the real server and,
 * when E2E_DATABASE_URL points at a migrated EMPTY PostgreSQL, a real PostgreSQL (otherwise the embedded one).
 * First administrator, TOTP, category, draft, real image upload, price/stock, publish, edit, reload, variants.
 */
const PASSWORD = "rain-over-the-woven-hills-92";
const EMAIL = "owner@example.test";
const PRICE = "4500000";
const PRICE_SHOWN = "۴٬۵۰۰٬۰۰۰";
const CATEGORY = "تابلو دیواری";

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ seedAccounts: false, firstRunSetup: true, ...(process.env.E2E_DATABASE_URL ? { databaseUrl: process.env.E2E_DATABASE_URL } : {}) });
}, 180_000);
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(60)}`);
});
afterAll(async () => {
  await h?.stop();
});

const shot = async (page: Page, name: string) => { if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png`, fullPage: true }); };
const toast = (page: Page, text: string | RegExp) => page.locator(".toast", { hasText: text }).first().waitFor();
const noSideScroll = async (page: Page, where: string) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `horizontal scroll on ${where}`).toBeLessThanOrEqual(0);

describe("product management, start to finish, on a phone", () => {
  it("first admin → category → draft → image → publish → edit → reload → variants", async () => {
    // A Pixel-class phone: 412x915 CSS px, touch, mobile UA.
    const ctx = await h.browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2.6,
      isMobile: true,
      hasTouch: true,
      locale: "fa-IR",
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
    });
    const problems: string[] = [];
    ctx.on("page", (p) => {
      p.on("console", (m) => m.type() === "error" && !/status of (401|422)/.test(m.text()) && problems.push(m.text()));
      p.on("pageerror", (e) => problems.push(e.message));
    });
    const page = await ctx.newPage();

    // 1. first administrator + TOTP, then a real sign-in
    await page.goto(`${h.baseUrl}/`);
    await pw(page.getByRole("heading", { name: "ساخت مدیر اول" })).toBeVisible();
    await page.getByLabel(/^ایمیل/).fill(EMAIL);
    await page.getByLabel(/^گذرواژه/).fill(PASSWORD);
    await page.getByLabel(/^تکرار گذرواژه/).fill(PASSWORD);
    await page.getByRole("button", { name: "ادامه" }).click();
    const href = (await page.getByRole("link", { name: "افزودن به برنامهٔ احراز هویت" }).getAttribute("href")) ?? "";
    const secret = new URL(href).searchParams.get("secret") ?? "";
    let step = totpStep(Date.now());
    const nextCode = () => totpAt(secret, step++);
    await page.getByLabel(/^کد ۶ رقمی/).fill(nextCode());
    await page.getByRole("button", { name: "ساخت مدیر" }).click();
    await pw(page.getByRole("heading", { name: "ورود به مدیریت جریان ما" })).toBeVisible();
    await page.getByLabel(/^ایمیل/).fill(EMAIL);
    await page.getByLabel(/^گذرواژه/).fill(PASSWORD);
    let signedIn = false;
    for (let attempt = 0; attempt < 3 && !signedIn; attempt++) {
      await page.getByLabel(/کد دومرحله‌ای/).fill(nextCode());
      await page.getByRole("button", { name: "ورود" }).click();
      signedIn = await page.getByRole("navigation", { name: "بخش‌های مدیریت" }).waitFor({ timeout: 4000 }).then(() => true, () => false);
    }
    expect(signedIn).toBe(true);
    await noSideScroll(page, "dashboard");

    // 2. category
    await page.goto(`${h.baseUrl}/admin/#/categories`);
    await page.getByLabel(/^نام/).fill(CATEGORY);
    await page.getByLabel(/نشانی \(انگلیسی\)/).fill("wall-hanging");
    await page.getByRole("button", { name: "ساخت دسته‌بندی" }).click();
    await toast(page, "دسته‌بندی ساخته شد");

    // 3. draft product with price and stock (a unique piece)
    await page.goto(`${h.baseUrl}/admin/#/products/new`);
    await page.getByLabel(/^نام محصول/).fill("تابلو دیواری گلیم طرح کوهستان");
    await page.getByLabel("توضیحات").fill("تابلوی دیواری بافته‌شده با دست. محصول آزمایشی.");
    await page.getByLabel("دسته‌بندی").selectOption({ label: CATEGORY });
    await page.getByLabel("قیمت (تومان)").fill(PRICE);
    await page.getByLabel("نشانی (اسلاگ)").fill("kuhestan-wall-hanging");
    await pw(page.getByLabel("موجودی")).toHaveValue("1");
    await noSideScroll(page, "basics tab");
    await shot(page, "basics");
    await page.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await toast(page, "محصول ذخیره شد");

    // publishing without an image is refused with a clear message, not a silent failure
    await page.getByRole("tab", { name: "اطلاعات" }).click();
    await page.getByRole("button", { name: "ایجاد و انتشار" }).or(page.getByRole("button", { name: "ذخیره و انتشار" })).click();
    await toast(page, "دست‌کم یک تصویر");
    await pw(page.getByText("برخی فیلدها نیاز به اصلاح دارند")).toBeVisible();

    // 4. a real image through the real file input: a large PNG that the browser must shrink and re-encode
    await page.getByRole("tab", { name: "تصاویر" }).click();
    await page.locator('input[type="file"][multiple]').setInputFiles({ name: "kuhestan.png", mimeType: "image/png", buffer: solidPng(2600, 1800, [176, 132, 92]) });
    await page.locator(".image-item").first().waitFor();
    await toast(page, "تصاویر بارگذاری شد");
    // the problem the failed publish reported (no image) is fixed: the banner and the tab dot must not linger until the next save
    await pw(page.getByText("برخی فیلدها نیاز به اصلاح دارند")).toHaveCount(0);
    await pw(page.getByRole("img", { name: "دارای خطا" })).toHaveCount(0);
    const src = (await page.locator(".image-item img").first().getAttribute("src")) ?? "";
    const served = await fetch(new URL(src, h.baseUrl));
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toMatch(/image\/(webp|jpeg)/);
    const bytes = new Uint8Array(await served.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(100);
    expect(bytes.length).toBeLessThan(5 * 1024 * 1024);
    await page.getByLabel("متن جایگزین (توصیف تصویر)").first().fill("تابلو دیواری گلیم با طرح کوهستان");
    await noSideScroll(page, "images tab");
    await shot(page, "images");

    // 5-6. publish
    await page.getByRole("button", { name: "ذخیره و انتشار" }).click();
    await toast(page, "منتشر شد");
    await pw(page.getByText("منتشرشده").first()).toBeVisible();

    // 8. reload: everything is still there (also checks the exact price round trip)
    await page.reload();
    await page.getByRole("tab", { name: "اطلاعات" }).waitFor();
    await pw(page.getByLabel(/^نام محصول/)).toHaveValue("تابلو دیواری گلیم طرح کوهستان");
    await pw(page.getByLabel("قیمت (تومان)")).toHaveValue(PRICE_SHOWN);
    await pw(page.getByLabel("دسته‌بندی")).toHaveValue(/.+/);
    await page.getByRole("tab", { name: "تصاویر" }).click();
    await pw(page.locator(".image-item")).toHaveCount(1);
    await pw(page.getByLabel("متن جایگزین (توصیف تصویر)")).toHaveValue("تابلو دیواری گلیم با طرح کوهستان");

    // 7. edit the PUBLISHED product: new price and name, save, reload
    await page.getByRole("tab", { name: "اطلاعات" }).click();
    await page.getByLabel(/^نام محصول/).fill("تابلو دیواری گلیم طرح کوهستان (ویرایش‌شده)");
    await page.getByLabel("قیمت (تومان)").fill("5200000");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await toast(page, "تغییرات ذخیره");
    await page.reload();
    await page.getByRole("tab", { name: "اطلاعات" }).waitFor();
    await pw(page.getByLabel(/^نام محصول/)).toHaveValue("تابلو دیواری گلیم طرح کوهستان (ویرایش‌شده)");
    await pw(page.getByLabel("قیمت (تومان)")).toHaveValue("۵٬۲۰۰٬۰۰۰");

    // 9. variants: stocked product with two sizes
    await page.getByLabel("نوع تحویل").selectOption("stocked");
    await page.getByRole("tab", { name: "گونه‌ها" }).click();
    await page.getByRole("button", { name: "افزودن گونه" }).click();
    await page.getByRole("button", { name: "افزودن گونه" }).click();
    const cards = page.locator(".variant-card");
    await pw(cards).toHaveCount(2);
    const fill = async (i: number, size: string, sku: string, price: string, stock: string) => {
      const card = cards.nth(i);
      await card.getByLabel("اندازه").fill(size);
      await card.getByLabel(/^کد کالا/).fill(sku);
      await card.getByLabel("قیمت (تومان)").fill(price);
      await card.getByLabel("موجودی").fill(stock);
    };
    await fill(0, "۵۰×۷۰", "KUH-50X70", "4500000", "3");
    await fill(1, "۷۰×۱۰۰", "KUH-70X100", "6800000", "2");
    await noSideScroll(page, "variants tab");
    await shot(page, "variants");

    // a duplicate SKU is explained and nothing is saved
    await cards.nth(1).getByLabel(/^کد کالا/).fill("KUH-50X70");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await toast(page, "تکراری");
    await cards.nth(1).getByLabel(/^کد کالا/).fill("KUH-70X100");
    await page.getByRole("button", { name: "ذخیره تغییرات" }).click();
    await toast(page, "تغییرات ذخیره");

    await page.reload();
    await page.getByRole("tab", { name: "گونه‌ها" }).click();
    await pw(page.locator(".variant-card")).toHaveCount(2);
    await pw(page.locator(".variant-card").nth(1).getByLabel(/^کد کالا/)).toHaveValue("KUH-70X100");
    await pw(page.locator(".variant-card").nth(1).getByLabel("قیمت (تومان)")).toHaveValue("۶٬۸۰۰٬۰۰۰");
    await pw(page.locator(".variant-card").nth(0).getByLabel("موجودی")).toHaveValue("3");

    // list view shows the published product
    await page.goto(`${h.baseUrl}/admin/#/products`);
    await pw(page.getByText("ویرایش‌شده").first()).toBeVisible();
    await noSideScroll(page, "product list");
    await shot(page, "list");

    // 8b. against a real PostgreSQL, the row is really there with the exact price (BIGINT)
    if (process.env.E2E_DATABASE_URL) {
      const rows = execFileSync("psql", [process.env.E2E_DATABASE_URL, "-At", "-c", "select status, fulfillment, \"priceToman\" from products where slug='kuhestan-wall-hanging'"], { encoding: "utf8" }).trim();
      expect(rows).toBe("published|stocked|5200000");
    }

    expect(problems).toEqual([]);
    await ctx.close();
  });
});

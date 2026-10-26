import { expect as pw } from "playwright/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright";
import { startHarness, type Harness } from "./harness";
import { solidPng } from "./png";

let h: Harness;
let ownerCtx: BrowserContext;
let owner: Page;

beforeAll(async () => {
  h = await startHarness();
  ownerCtx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
  owner = await h.login(ownerCtx, h.accounts.owner);
});
afterAll(async () => {
  await h?.stop();
});

const toast = (page: Page, text: string | RegExp) => page.locator(".toast", { hasText: text }).first().waitFor();

describe("admin PWA end to end (real server, real database, real TOTP)", () => {
  it("rejects a wrong TOTP code and shows a Persian message", async () => {
    const ctx = await h.browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${h.baseUrl}/admin/`);
    await page.getByLabel("ایمیل").fill(h.accounts.owner.email);
    await page.getByLabel(/^گذرواژه/).fill(h.accounts.owner.password);
    await page.getByLabel(/کد دومرحله‌ای/).fill("000000");
    await page.getByRole("button", { name: "ورود" }).click();
    await pw(page.getByRole("alert")).toContainText("دومرحله‌ای");
    await ctx.close();
  });

  it("creates a category, then a product with variants, images and SEO; publishes it", async () => {
    await owner.goto(`${h.baseUrl}/admin/#/categories`);
    await owner.getByLabel(/^نام/).fill("پرده دیواری");
    await owner.getByLabel(/نشانی \(انگلیسی\)/).fill("wall-hanging");
    await owner.getByRole("button", { name: "ساخت دسته‌بندی" }).click();
    await toast(owner, "دسته‌بندی ساخته شد");

    await owner.goto(`${h.baseUrl}/admin/#/products/new`);
    await owner.getByLabel(/^نام محصول/).fill("پرده بافته شده نمونه");
    await owner.getByLabel("دسته‌بندی").selectOption({ label: "پرده دیواری" });
    await owner.getByLabel("نوع تحویل").selectOption("stocked");
    await owner.getByLabel("قیمت (تومان)").fill("۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹");
    await owner.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await toast(owner, "محصول ذخیره شد");

    // images tab (product now exists): upload through the real file input, exactly like a gallery pick
    await owner.getByRole("tab", { name: "تصاویر" }).click();
    await owner.locator('input[type="file"][multiple]').setInputFiles([
      { name: "a.png", mimeType: "image/png", buffer: solidPng(40, 50, [200, 160, 120]) },
      { name: "b.png", mimeType: "image/png", buffer: solidPng(40, 50, [90, 110, 70]) },
    ]);
    await owner.locator(".image-item").nth(1).waitFor();
    await owner.getByRole("button", { name: "انتقال تصویر 2 به قبل" }).click();
    await owner.getByLabel("متن جایگزین (توصیف تصویر)").first().fill("بافته دستی با رنگ‌های خاکی");

    // SEO overrides
    await owner.getByRole("tab", { name: "سئو" }).click();
    await owner.getByLabel("عنوان سئو").fill("پرده بافته دستی");
    await owner.getByRole("button", { name: "استفاده از توضیح" }).click();

    await owner.getByRole("button", { name: "ذخیره و انتشار" }).click();
    await toast(owner, "منتشر شد");

    // the exact price survived the round trip (BigInt-safe): reload and read the field
    await owner.reload();
    await owner.getByRole("tab", { name: "اطلاعات" }).waitFor();
    await pw(owner.getByLabel("قیمت (تومان)")).toHaveValue("۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹٬۹۹۹");
    await owner.getByRole("tab", { name: "سئو" }).click();
    await pw(owner.getByLabel("عنوان سئو")).toHaveValue("پرده بافته دستی");
  });

  it("lists, searches, duplicates and archives", async () => {
    await owner.goto(`${h.baseUrl}/admin/#/products`);
    await owner.getByText("پرده بافته شده نمونه").first().waitFor();
    await owner.getByRole("searchbox").fill("بافته");
    await owner.waitForURL(/q=/);
    await owner.getByRole("button", { name: "کپی" }).first().click();
    await toast(owner, "نسخهٔ کپی");
    await owner.getByLabel(/^نام محصول/).waitFor();
    expect(await owner.getByLabel(/^نام محصول/).inputValue()).toContain("(کپی)");
    await owner.goto(`${h.baseUrl}/admin/#/products`);
    await owner.getByRole("button", { name: "بایگانی" }).first().click();
    await owner.getByRole("dialog").getByRole("button", { name: "بایگانی" }).click();
    await toast(owner, "بایگانی شد");
  });

  it("exports and re-imports CSV (with a bad row reported in Persian)", async () => {
    await owner.goto(`${h.baseUrl}/admin/#/data`);
    const [download] = await Promise.all([owner.waitForEvent("download"), owner.getByRole("button", { name: "دریافت خروجی" }).click()]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const { readFileSync } = await import("node:fs");
    const csv = readFileSync(path!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("پرده بافته دستی");

    await owner.locator("#csv-file").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("slug,name,fulfillment,price_toman\r\nx,نمونه,unique,12.5\r\n") });
    await pw(owner.getByRole("alert").first()).toContainText("مشکل");
    await pw(owner.getByRole("region", { name: "فهرست مشکلات فایل" })).toContainText("عدد معتبر نیست");

    await owner.locator("#csv-file").setInputFiles({ name: "ok.csv", mimeType: "text/csv", buffer: Buffer.from("slug,name,fulfillment,price_toman,inventory\r\ncsv-one,نمونه یک,unique,1500000,1\r\ncsv-two,نمونه دو,unique,,0\r\n") });
    await owner.getByRole("button", { name: /^ثبت/ }).click();
    await owner.getByText(/ورود انجام شد/).waitFor();
  });
});

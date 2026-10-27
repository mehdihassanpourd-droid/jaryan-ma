import { expect as pw } from "playwright/test";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
// A failed test prints what the server was doing: intermittent stalls are otherwise undiagnosable.
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(60)}`);
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

  it("keeps the tab the person chose while a new product is still saving (no forced jump, no remount)", async () => {
    // Slow the create call down so the "still saving" window is wide and the check is deterministic.
    await owner.route("**/api/v1/products", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });
    try {
      await owner.goto(`${h.baseUrl}/admin/#/products/new`);
      await owner.getByRole("heading", { name: "محصول جدید" }).waitFor();
      await owner.getByLabel(/^نام محصول/).fill("آزمون ماندن در تب");
      await owner.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
      await owner.getByRole("tab", { name: "سئو" }).click(); // chosen while the save is in flight
      await owner.locator(".toast", { hasText: "محصول ذخیره شد" }).first().waitFor();
      await pw(owner.getByRole("tab", { name: "سئو" })).toHaveAttribute("aria-selected", "true");
      await pw(owner.getByLabel("عنوان سئو")).toBeVisible();
      // the address now names the saved product, and the page was not reloaded or re-rendered from scratch
      expect(owner.url()).toMatch(/#\/products\/[A-Za-z0-9-]{8,}$/);
    } finally {
      await owner.unroute("**/api/v1/products");
    }
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
    try {
      await owner.goto(`${h.baseUrl}/admin/#/data`);
      // Race the download against the page's own error alert so a failure says WHY instead of timing out blindly.
      const downloadPromise = owner.waitForEvent("download");
      downloadPromise.catch(() => undefined);
      await owner.getByRole("button", { name: "دریافت خروجی" }).click({ timeout: 15_000 });
      const failure = owner.getByRole("alert").first();
      const outcome = await Promise.race([downloadPromise, failure.waitFor({ timeout: 25_000 }).then(async () => `export failed: ${await failure.innerText()}`)]);
      if (typeof outcome === "string") throw new Error(outcome);
      const download = outcome;
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
    } catch (error) {
      // CI-only stalls have been seen here: say what the page and the server were doing instead of a bare timeout.
      const pageText = await owner.locator("body").innerText().catch(() => "(page unreadable)");
      throw new Error(`${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n--- url: ${owner.url()}\n--- page: ${pageText.slice(0, 600)}\n--- server log (tail):\n${h.serverLog()}`);
    }
  });
});

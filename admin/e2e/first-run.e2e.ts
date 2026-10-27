import { expect as pw } from "playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { totpAt, totpStep } from "../../server/auth/totp";
import { startHarness, type Harness } from "./harness";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const PASSWORD = "rain-over-the-woven-hills-92";
const EMAIL = "first@example.test";

let h: Harness;
beforeAll(async () => {
  h = await startHarness({ seedAccounts: false, firstRunSetup: true });
}, 180_000);
// A failed test prints what the server was doing: intermittent stalls are otherwise undiagnosable.
afterEach((context) => {
  if (context.task.result?.state === "fail") console.error(`--- server log (tail) after "${context.task.name}":\n${h?.serverLog(60)}`);
});
afterAll(async () => {
  await h?.stop();
});

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: Document, o: object): Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}

describe("first run on a fresh server: no terminal, still password + TOTP", () => {
  it("opens the admin from the bare address, creates the first administrator in the browser, then signs in with TOTP", async () => {
    const ctx = await h.browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fa-IR" });
    const problems: string[] = [];
    ctx.on("page", (p) => {
      // 401 (wrong code / signed-out probe) and 422 (the deliberately weak password) are expected; anything else is a defect.
      p.on("console", (m) => m.type() === "error" && !/status of (401|422)/.test(m.text()) && problems.push(m.text()));
      p.on("pageerror", (e) => problems.push(e.message));
    });
    const page = await ctx.newPage();

    // what a forwarded port's "open in browser" shows: the bare address, not a 404
    const response = await page.goto(`${h.baseUrl}/`);
    expect(response?.status()).toBe(200);
    expect(page.url()).toBe(`${h.baseUrl}/admin/`);
    await pw(page.getByRole("heading", { name: "ساخت مدیر اول" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(await axeViolations(page)).toEqual([]);

    // a weak password is explained, not silently accepted
    await page.getByLabel(/^ایمیل/).fill(EMAIL);
    await page.getByLabel(/^گذرواژه/).fill("short");
    await page.getByLabel(/^تکرار گذرواژه/).fill("short");
    await page.getByRole("button", { name: "ادامه" }).click();
    await pw(page.getByRole("alert")).toContainText("۱۲ نویسه");

    await page.getByLabel(/^گذرواژه/).fill(PASSWORD);
    await page.getByLabel(/^تکرار گذرواژه/).fill(PASSWORD);
    await page.getByRole("button", { name: "ادامه" }).click();

    // the secret is shown for the authenticator app; the person must prove it works with a current code
    await pw(page.getByRole("link", { name: "افزودن به برنامهٔ احراز هویت" })).toBeVisible();
    const href = (await page.getByRole("link", { name: "افزودن به برنامهٔ احراز هویت" }).getAttribute("href")) ?? "";
    expect(href.startsWith("otpauth://totp/")).toBe(true);
    const secret = new URL(href).searchParams.get("secret") ?? "";
    expect(secret).toMatch(/^[A-Z2-7]{20,}$/);
    expect(await axeViolations(page)).toEqual([]);

    await page.getByLabel(/^کد ۶ رقمی/).fill("000000");
    await page.getByRole("button", { name: "ساخت مدیر" }).click();
    await pw(page.getByRole("alert")).toContainText("کد دومرحله‌ای");
    await page.getByLabel(/^کد ۶ رقمی/).fill(totpAt(secret, totpStep(Date.now())));
    await page.getByRole("button", { name: "ساخت مدیر" }).click();

    // setup closed itself; the normal login form is shown and now demands password + a code
    await pw(page.getByRole("heading", { name: "ورود به مدیریت جریان ما" })).toBeVisible();
    await page.getByLabel(/^ایمیل/).fill(EMAIL);
    await page.getByLabel(/^گذرواژه/).fill(PASSWORD);
    await page.getByRole("button", { name: "ورود" }).click();
    await pw(page.getByRole("alert")).toContainText("دومرحله‌ای"); // no code -> refused

    let signedIn = false;
    for (const offset of [1, 0, -1]) {
      await page.getByLabel(/کد دومرحله‌ای/).fill(totpAt(secret, totpStep(Date.now()) + offset));
      await page.getByRole("button", { name: "ورود" }).click();
      signedIn = await page.getByRole("navigation", { name: "بخش‌های مدیریت" }).waitFor({ timeout: 4000 }).then(() => true, () => false);
      if (signedIn) break;
    }
    expect(signedIn).toBe(true);

    // and the product screens work for this account
    await page.goto(`${h.baseUrl}/admin/#/products/new`);
    await page.getByLabel(/^نام محصول/).fill("نخستین محصول آزمایشی");
    await page.getByRole("button", { name: "ذخیره پیش‌نویس" }).click();
    await page.locator(".toast", { hasText: "محصول ذخیره شد" }).first().waitFor();

    // setup can never be reopened: a fresh visitor sees the login page, not the setup page
    const other = await (await h.browser.newContext({ locale: "fa-IR" })).newPage();
    await other.goto(`${h.baseUrl}/admin/`);
    await pw(other.getByRole("heading", { name: "ورود به مدیریت جریان ما" })).toBeVisible();
    expect(problems).toEqual([]);
    await ctx.close();
  });

  it("an unbuilt or missing UI is never silent about it (API root and unknown paths)", async () => {
    expect((await fetch(`${h.baseUrl}/nope`)).status).toBe(404);
    expect((await fetch(`${h.baseUrl}/healthz`)).status).toBe(200);
  });
});

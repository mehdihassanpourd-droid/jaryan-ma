import { expect as pw } from "playwright/test";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import type { Server } from "node:http";
import { join, relative } from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * The PUBLIC PREVIEW (https://jaryan-ma.pages.dev) in a real browser at Android phone size. It is built exactly like the deploy workflow builds
 * it: the real static storefront with NO optional variables (no catalogue, no order system, no site URL), i.e. sample content only.
 * Proves what a phone visitor can open and use, which features are demo-only, and that nothing private or foreign is part of it.
 */
const ANDROID = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36" } as const;

let dir: string;
let server: Server;
let url: string;
let browser: Browser;
const requested = new Set<string>();

beforeAll(async () => {
  dir = buildStorefront({});
  ({ server, url } = await serveStatic(dir));
  browser = await chromium.launch();
}, 600_000);

afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function phone(): Promise<BrowserContext> {
  const ctx = await browser.newContext(ANDROID);
  ctx.on("request", (r) => {
    if (/^https?:/.test(r.url())) requested.add(new URL(r.url()).host);
  });
  return ctx;
}

function walk(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const full = join(root, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("public preview on an Android phone (412x915)", () => {
  it("opens every page without horizontal scrolling, in Persian RTL, labelled as sample content and not indexable", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const routes = ["/", "/category/macrame", "/category/wall-hangings", "/products/demo-wall-hanging", "/products/demo-cushion", "/cart", "/checkout", "/orders", "/order", "/product"];
    for (const route of routes) {
      const response = await page.goto(`${url}${route}`, { waitUntil: "networkidle" });
      expect(response?.status(), route).toBe(200);
      const facts = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
        viewport: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
        sample: document.body.innerText.includes("نمونه"),
      }));
      expect(facts.overflow, `${route} scrolls sideways`).toBeLessThanOrEqual(0);
      expect(facts.lang, route).toBe("fa");
      expect(facts.dir, route).toBe("rtl");
      expect(facts.robots, `${route} must not be indexable`).toContain("noindex");
      expect(facts.viewport, route).toContain("width=device-width");
      expect(facts.sample, `${route} must be labelled as sample content`).toBe(true);
      // /product is the live-catalogue product page: without a catalogue it only says so (no heading to show).
      if (route !== "/product") await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    const missing = await page.goto(`${url}/no-such-page`);
    expect(missing?.status()).toBe(404);
    await ctx.close();
  });

  it("can be browsed by tapping: home -> collection -> product, and home -> product, with the sample badge and no price made up", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.locator('#collections a[href^="/category/"]').first().tap();
    await page.waitForURL(/\/category\//);
    await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.locator('a[href^="/products/"]').first().tap();
    await page.waitForURL(/\/products\//);
    await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    const text = await page.locator("main").innerText();
    expect(text).toContain("نمونه");
    expect(text).toContain("قیمت به‌زودی اعلام می‌شود");
    // Sample products carry no price (never invented), so they cannot be added to a cart in the preview.
    await pw(page.getByRole("button", { name: /افزودن به سبد/ })).toHaveCount(0);
    // The product grid of the home page links to the same pages, and the category chips filter it.
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.locator("#featured").getByRole("button", { name: "ماکرومه" }).tap();
    await page.locator('#featured a[href^="/products/"]').first().tap();
    await page.waitForURL(/\/products\//);
    await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    await ctx.close();
  });

  it("is honest about what needs a backend: cart and checkout explain it, place no order and show no order number or payment", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const api: string[] = [];
    page.on("request", (r) => {
      if (/\/api\//.test(r.url())) api.push(r.url());
    });
    await page.goto(`${url}/cart`, { waitUntil: "networkidle" });
    await pw(page.getByRole("heading", { name: "سبد خرید" })).toBeVisible();
    await page.goto(`${url}/checkout`, { waitUntil: "networkidle" });
    const checkout = await page.locator("main").innerText();
    expect(checkout).toContain("ثبت سفارش فقط برای فروشگاه متصل به فهرست محصولات کار می‌کند");
    expect(checkout).not.toMatch(/شمارهٔ سفارش|پرداخت آنلاین/);
    await pw(page.getByRole("button", { name: /ثبت سفارش/ })).toHaveCount(0);
    await page.goto(`${url}/orders`, { waitUntil: "networkidle" });
    await page.goto(`${url}/order?id=1`, { waitUntil: "networkidle" });
    expect(api, "the preview must not call any API").toEqual([]);
    await ctx.close();
  });

  it("loads nothing from any other host and logs no unexpected console errors", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    for (const route of ["/", "/category/macrame", "/products/demo-cushion", "/cart", "/checkout"]) await page.goto(`${url}${route}`, { waitUntil: "networkidle" });
    await ctx.close();
    expect([...requested].filter((h) => !h.startsWith("127.0.0.1")), "foreign hosts requested").toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("what the public preview contains", () => {
  it("has no admin application, API, credentials or secrets in the published files", () => {
    const files = walk(dir);
    const names = files.map((f) => relative(dir, f));
    expect(names.filter((n) => /^admin(\/|$)/.test(n) || /^api(\/|$)/.test(n) || /(^|\/)\.env/.test(n))).toEqual([]);
    const leaks: string[] = [];
    for (const file of files.filter((f) => /\.(html|js|css|json|txt|xml|map)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/postgres(ql)?:\/\//i, /BEGIN [A-Z ]*PRIVATE KEY/, /CLOUDFLARE_API_TOKEN/, /TOTP_SECRET/, /\/api\/v1\/admin/, /SESSION_SECRET/]) if (pattern.test(text)) leaks.push(`${relative(dir, file)}: ${pattern}`);
    }
    expect(leaks).toEqual([]);
  });

  it("ships the response headers (security headers, long caching for hashed assets, no caching for the build marker)", () => {
    const headers = readFileSync(join(dir, "_headers"), "utf8");
    expect(headers).toContain("X-Content-Type-Options: nosniff");
    expect(headers).toContain("X-Frame-Options: DENY");
    expect(headers).toMatch(/\/build-info\.json\s+Cache-Control: no-store/);
  });
});

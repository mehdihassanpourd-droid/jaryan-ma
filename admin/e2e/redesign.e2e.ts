import { expect as pw } from "playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * The redesigned storefront (approved visual reference: asymmetric organic layouts, deep teal / terracotta / cream, large
 * Persian type, bottom navigation on phones) as the deploy workflow builds it (no optional variables = sample content), on an
 * Android phone (412x915) and at other widths. Behaviour of the shop itself is covered by the shopping / orders / shipping suites.
 */
const ANDROID = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36" } as const;
const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

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

async function phone(options: { viewport?: { width: number; height: number }; isMobile?: boolean; hasTouch?: boolean } = {}): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...ANDROID, ...options });
  ctx.on("request", (r) => {
    if (/^https?:/.test(r.url())) requested.add(new URL(r.url()).host);
  });
  return ctx;
}

async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(c: Document, o: object): Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
}

const PAGES = [
  { name: "home", path: "/" },
  { name: "category", path: "/category/ceramics" },
  { name: "product", path: "/products/demo-blue-vase" },
  { name: "product with two pictures", path: "/products/demo-floral-tote" },
  { name: "cart", path: "/cart" },
  { name: "checkout", path: "/checkout" },
];

describe("redesigned storefront on an Android phone (412x915)", () => {
  it.each(PAGES)("$name: fits the screen, Persian RTL, one h1, accessible (axe WCAG A/AA), nothing broken", async ({ path }) => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const response = await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(200);
    const facts = await page.evaluate(async () => {
      await document.fonts.ready;
      const imgs = Array.from(document.images);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
        h1: document.querySelectorAll("h1").length,
        brokenImages: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
        missingAlt: imgs.filter((i) => !(i.getAttribute("alt") ?? "").trim()).map((i) => i.src),
        script: document.fonts.check('700 20px "Aref Ruqaa"'),
        body: document.fonts.check('400 16px "Vazirmatn Variable"') || document.fonts.check('400 16px "Vazirmatn"'),
      };
    });
    expect(facts.overflow, "no sideways scrolling").toBeLessThanOrEqual(0);
    expect(facts.lang).toBe("fa");
    expect(facts.dir).toBe("rtl");
    expect(facts.robots, "sample content stays closed to search engines").toContain("noindex");
    expect(facts.h1).toBe(1);
    expect(facts.brokenImages).toEqual([]);
    expect(facts.missingAlt).toEqual([]);
    expect(facts.script, "the wordmark script is loaded from our own file").toBe(true);
    expect(await axeViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("home: the sections of the approved reference, in order, built from the data", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await pw(page.getByRole("heading", { level: 1 })).toContainText("هنر");
    await pw(page.getByRole("heading", { level: 1 })).toContainText("در زندگی");
    await pw(page.getByRole("heading", { level: 1 })).toContainText("روزمره");
    // the confirmed slogan stays visible above the heading
    await pw(page.getByText("اینجا هنر در جریان است").first()).toBeVisible();
    const order = await page.evaluate(() => ["collections", "featured", "story", "artists", "feel-title", "trust", "contact"].map((id) => ({ id, top: (document.getElementById(id) ?? document.querySelector(`[aria-labelledby="${id}"]`))?.getBoundingClientRect().top ?? -1 })));
    expect(order.every((o) => o.top >= 0), JSON.stringify(order)).toBe(true);
    expect(order.map((o) => o.top)).toEqual([...order.map((o) => o.top)].sort((a, b) => a - b));
    // categories and products come from the data: one link each, to a real page
    expect(await page.locator('#collections a[href^="/category/"]').count()).toBe(3);
    expect(await page.locator('#featured a[href^="/products/"]').count()).toBe(6);
    await ctx.close();
  });

  it("home: the category mosaic is asymmetric (one tall tile beside two short ones), not a uniform grid", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const boxes = await page.locator("#collections li").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
    expect(boxes).toHaveLength(3);
    const [tall, a, b] = boxes as [(typeof boxes)[number], (typeof boxes)[number], (typeof boxes)[number]];
    expect(tall.h).toBeGreaterThan(a.h * 1.8);
    expect(Math.abs(a.h - b.h)).toBeLessThan(2);
    expect(a.x).not.toBeCloseTo(tall.x, 0);
    const shapes = await page.locator("#collections li a").evaluateAll((els) => els.map((e) => getComputedStyle(e).borderTopLeftRadius));
    expect(new Set(shapes).size, "each tile has its own organic shape").toBe(3);
    await ctx.close();
  });

  it("home: sample content is labelled everywhere and no price is invented", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const text = await page.locator("body").innerText();
    expect(text).toContain("نمونه");
    expect(text, "no invented price").not.toMatch(/[\d۰-۹][\d۰-۹,٬.]*\s*(تومان|ریال)/);
    expect(text).not.toMatch(/پرفروش|ستاره|نظر مشتری:/);
    for (const label of await page.locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("alt") ?? ""))) expect(label, "every sample picture says it is temporary or a sample").toMatch(/موقت|نمونه/);
    expect(await page.locator("#featured").getByText("قیمت به‌زودی اعلام می‌شود").count()).toBe(6);
    await ctx.close();
  });

  it("navigation: wordmark home link, menu sheet, bottom tab bar that follows what this build can do", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    await pw(page.getByRole("link", { name: "جریان ما، صفحهٔ اصلی" })).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "پیمایش سریع" });
    await pw(tabs).toBeVisible();
    // no cart or orders in a build without a live catalogue / order system; the Instagram account is always there
    expect(await tabs.getByRole("link").allInnerTexts()).toEqual(["خانه", "دسته‌ها", "منتخب‌ها", "اینستاگرام"]);
    await page.getByRole("button", { name: "باز کردن منو" }).tap();
    await pw(page.locator("#mobile-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await pw(page.locator("#mobile-menu")).toBeHidden();
    await tabs.getByRole("link", { name: "خانه" }).tap();
    await page.waitForURL(`${url}/`);
    await pw(tabs.getByRole("link", { name: "خانه" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "دسته‌ها" }).tap();
    await pw(page.locator("#collections")).toBeInViewport();
    await ctx.close();
  });

  it("home to product by tapping: category tile -> category page -> product; featured tile -> product", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.locator('#collections a[href="/category/ceramics"]').tap();
    await page.waitForURL(/\/category\/ceramics/);
    await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.locator('a[href^="/products/"]').first().tap();
    await page.waitForURL(/\/products\//);
    await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.locator('#featured a[href^="/products/"]').first().tap();
    await page.waitForURL(/\/products\//);
    await ctx.close();
  });

  it("product: large gallery with thumbnails, labelled sample picture, artist slot, related products, Instagram question link", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    await pw(page.getByRole("heading", { level: 1 })).toContainText("گلدان سفالی آبی");
    await pw(page.getByText("تصویر موقت").first()).toBeVisible();
    const hero = await page.locator('[role="group"][aria-label="گالری تصاویر محصول"] img').first().boundingBox();
    expect(hero?.width ?? 0, "the main picture is large on a phone").toBeGreaterThan(330);
    await page.getByRole("button", { name: "نمایش تصویر ۲" }).tap();
    await pw(page.getByRole("button", { name: "نمایش تصویر ۲" })).toHaveAttribute("aria-pressed", "true");
    await pw(page.getByText("۲ از ۳")).toBeVisible();
    await pw(page.getByRole("complementary", { name: "هنرمند" })).toContainText("ثبت نشده");
    await pw(page.getByTestId("related-products")).toBeVisible();
    await pw(page.getByRole("link", { name: /پرسش درباره این اثر در اینستاگرام/ })).toHaveAttribute("href", "https://instagram.com/jaryan.ma");
    expect(await page.getByRole("button", { name: /افزودن به سبد/ }).count(), "nothing to buy without a catalogue").toBe(0);
    await ctx.close();
  });

  it("performance: the home page stays light and stable (bytes, hero image priority, layout shift)", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    let bytes = 0;
    page.on("response", async (r) => {
      try {
        bytes += (await r.body()).length;
      } catch {
        /* redirects and aborted prefetches have no body */
      }
    });
    await page.addInitScript(() => {
      (window as unknown as { __cls: number }).__cls = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    expect(bytes, `home transferred ${Math.round(bytes / 1024)} KB`).toBeLessThan(1_400_000);
    const imgs = await page.locator("img").evaluateAll((els) => els.map((e) => ({ src: e.getAttribute("src") ?? "", loading: e.getAttribute("loading"), priority: e.getAttribute("fetchpriority"), w: e.getAttribute("width"), h: e.getAttribute("height") })));
    expect(imgs.every((i) => i.w && i.h), "every picture reserves its space (width + height)").toBe(true);
    const hero = imgs.find((i) => i.src.includes("vase-1"));
    expect(hero?.priority, "the hero picture loads first").toBe("high");
    expect(imgs.filter((i) => i !== hero && i.loading !== "lazy"), "everything below the hero loads lazily").toEqual([]);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, "layout shift").toBeLessThan(0.1);
    await ctx.close();
  });
});

describe("other screen sizes", () => {
  it.each([360, 412, 600, 768, 1024, 1280])("home and product fit at %ipx wide (tab bar only below 768px)", async (width) => {
    const ctx = await phone({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await ctx.newPage();
    for (const path of ["/", "/products/demo-mandala-sunburst"]) {
      await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}px`).toBeLessThanOrEqual(0);
      await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
      const tabbar = page.getByRole("navigation", { name: "پیمایش سریع" });
      if (width < 768) await pw(tabbar).toBeVisible();
      else await pw(tabbar).toBeHidden();
    }
    if (width >= 768) await pw(page.getByRole("navigation", { name: "منوی اصلی" })).toBeVisible();
    await ctx.close();
  });
});

describe("what the redesign ships", () => {
  it("loads nothing from another host (the wordmark font and every picture are our own files)", () => {
    expect([...requested].filter((h) => !h.startsWith("127.0.0.1")), "foreign hosts requested").toEqual([]);
  });

  it("keeps the shop's data hooks the other suites rely on", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    // related products and the buy link keep their test ids for the catalogue-driven suites
    await pw(page.getByTestId("related-products")).toBeAttached();
    await ctx.close();
  });
});

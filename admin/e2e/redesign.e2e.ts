import { expect as pw } from "playwright/test";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * The redesigned storefront (a contemporary art gallery: sharp rectangles only, asymmetric editorial compositions, ink black /
 * warm white / vermilion, very large Persian type, bottom navigation on phones) as the deploy workflow builds it (no optional variables = sample content), on an
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

async function phone(options: { viewport?: { width: number; height: number }; isMobile?: boolean; hasTouch?: boolean; reducedMotion?: "reduce" | "no-preference" } = {}): Promise<BrowserContext> {
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
    // the page is long: walk down it once so every lazy picture has been asked for, then judge them
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 500) {
        window.scrollTo({ top: y, behavior: "instant" });
        await new Promise((r) => setTimeout(r, 80));
      }
      window.scrollTo({ top: 0, behavior: "instant" });
    });
    await page.waitForLoadState("networkidle");
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
        // the gallery look: straight edges only (native radio buttons and checkboxes keep the browser's own shape)
        curved: Array.from(document.querySelectorAll("body *"))
          .filter((e) => {
            if (e instanceof SVGElement || e.matches('input[type="radio"], input[type="checkbox"]')) return false;
            const c = getComputedStyle(e);
            return [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomLeftRadius, c.borderBottomRightRadius].some((v) => parseFloat(v) > 0);
          })
          .slice(0, 5)
          .map((e) => `${e.tagName.toLowerCase()}.${String(e.getAttribute("class") ?? "")}`),
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
    expect(facts.curved, "no curved frames, blobs, pills or rounded cards anywhere").toEqual([]);
    expect(await axeViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("home: the gallery sections, in order, built from the data", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await pw(page.getByRole("heading", { level: 1 })).toContainText("هنر");
    await pw(page.getByRole("heading", { level: 1 })).toContainText("در زندگی");
    await pw(page.getByRole("heading", { level: 1 })).toContainText("روزمره");
    // large type: the heading is a poster headline, not a section title (still very large on a wide screen, see the width tests)
    expect(await page.getByRole("heading", { level: 1 }).evaluate((h) => parseFloat(getComputedStyle(h).fontSize))).toBeGreaterThanOrEqual(40);
    // the confirmed slogan stays visible above the heading
    await pw(page.getByText("اینجا هنر در جریان است").first()).toBeVisible();
    const order = await page.evaluate(() => ["collections", "featured", "scope", "story", "artists", "feel-title", "trust", "contact"].map((id) => ({ id, top: (document.getElementById(id) ?? document.querySelector(`[aria-labelledby="${id}"]`))?.getBoundingClientRect().top ?? -1 })));
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
    expect(tall.w, "the columns are unequal too").toBeGreaterThan(a.w * 1.2);
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
    for (const label of await page.locator('img:not([src*="/brand/"])').evaluateAll((els) => els.map((e) => e.getAttribute("alt") ?? ""))) expect(label, "every sample picture says it is temporary or a sample").toMatch(/موقت|نمونه/);
    expect(await page.locator("#featured").getByText("قیمت به‌زودی اعلام می‌شود").count()).toBe(6);
    await ctx.close();
  });

  it("navigation: logo home link, menu sheet, bottom tab bar that follows what this build can do", async () => {
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
    expect(imgs.filter((i) => i !== hero && i.loading !== "lazy" && !i.src.includes("/brand/jaryan-ma-mark-cream-240")), "everything below the hero loads lazily (the header logo is the one other eager picture)").toEqual([]);
    const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
    expect(cls, "layout shift").toBeLessThan(0.1);
    await ctx.close();
  });
  it("home: a short hero, so the collections start within the first screen of a phone", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const hero = await page.locator('section[aria-labelledby="hero-title"]').boundingBox();
    expect(hero!.height, "hero height on a 915px-tall phone").toBeLessThanOrEqual(480);
    const collections = await page.locator("#collections").boundingBox();
    expect(collections!.y, "the collections heading is visible without scrolling").toBeLessThan(700);
    // two ways in from the hero
    await pw(page.getByRole("link", { name: "دیدن آثار" })).toBeVisible();
    await pw(page.getByRole("link", { name: "مجموعه‌ها", exact: true }).first()).toBeVisible();
    await ctx.close();
  });

  it("header: official logo, a visible cart button, 48px touch targets and an accessible menu", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const header = page.locator("header");
    const box = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!;
    const logo = await box(header.locator('img[src*="/brand/jaryan-ma-mark"]'));
    expect(logo.height, "the logo stays recognisable").toBeGreaterThanOrEqual(56);
    const cart = header.getByRole("link", { name: "سبد خرید" });
    await pw(cart).toBeVisible();
    const cartBox = await box(cart);
    const menu = header.getByRole("button", { name: "باز کردن منو" });
    const menuBox = await box(menu);
    for (const [what, b] of [["cart", cartBox], ["menu", menuBox]] as const) {
      expect(b.width, `${what} touch width`).toBeGreaterThanOrEqual(44);
      expect(b.height, `${what} touch height`).toBeGreaterThanOrEqual(44);
    }
    expect((await box(header)).height, "the header leaves the page room").toBeLessThanOrEqual(84);
    // the menu: expanded state, 48px links, Escape returns focus, a tap outside closes it
    await menu.tap();
    await pw(page.getByRole("button", { name: "بستن منو" })).toHaveAttribute("aria-expanded", "true");
    const links = page.locator("#mobile-menu").getByRole("link");
    for (const heightOf of await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(heightOf).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Escape");
    await pw(page.locator("#mobile-menu")).toBeHidden();
    await pw(page.getByRole("button", { name: "باز کردن منو" })).toBeFocused();
    await page.getByRole("button", { name: "باز کردن منو" }).tap();
    await page.mouse.click(200, 600);
    await pw(page.locator("#mobile-menu")).toBeHidden();
    await ctx.close();
  });

  it("product discovery: consistent cards in one grid, large pictures, readable names and prices, clear collection navigation", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const cards = await page.locator("#featured article").evaluateAll((els) =>
      els.map((e) => {
        const pic = e.querySelector("img")!.parentElement!.parentElement!.getBoundingClientRect();
        const name = getComputedStyle(e.querySelector("h3")!);
        return { ratio: pic.width / pic.height, w: pic.width, name: parseFloat(name.fontSize), nameWeight: parseInt(name.fontWeight, 10), price: (e.textContent ?? "").length > 0 };
      }),
    );
    expect(cards).toHaveLength(6);
    for (const c of cards) {
      expect(c.ratio, "every picture is 4:5").toBeCloseTo(0.8, 1);
      expect(c.name, "readable name").toBeGreaterThanOrEqual(17);
      expect(c.nameWeight).toBeGreaterThanOrEqual(800);
    }
    expect(Math.min(...cards.map((c) => c.w)), "pictures are large even in the half-width cards").toBeGreaterThan(150);
    expect(Math.max(...cards.map((c) => c.w)), "the lead card of each trio takes the full width").toBeGreaterThan(300);
    // the category page: every collection is one tap away, the current one is marked, targets are 48px
    await page.goto(`${url}/category/ceramics`, { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "مجموعه‌ها" });
    await pw(nav.getByRole("link")).toHaveCount(4); // all + the three collections
    await pw(nav.getByRole("link", { name: "سفال و سرامیک" })).toHaveAttribute("aria-current", "page");
    for (const h of await nav.getByRole("link").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(48);
    await nav.getByRole("link", { name: "کیف پارچه‌ای نقاشی‌دست" }).tap();
    await page.waitForURL(/\/category\/tote-bags/);
    await ctx.close();
  });

  it("header logo: a semantic link to the home page that works by tap, click and keyboard, on phone and desktop", async () => {
    const LABEL = "جریان ما، صفحهٔ اصلی";
    for (const device of [
      { name: "phone 412px", ctx: () => phone(), tap: true },
      { name: "desktop 1280px", ctx: () => phone({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false }), tap: false },
    ]) {
      const ctx = await device.ctx();
      const page = await ctx.newPage();
      await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
      const link = page.locator("header").getByRole("link", { name: LABEL });
      // semantics: a real <a href="/">, named in Persian, holding the official logo file (alt = brand name), big enough to touch
      await pw(link).toHaveCount(1);
      await pw(link).toHaveAttribute("href", "/");
      expect(await link.evaluate((a) => a.tagName), `${device.name}: a real anchor`).toBe("A");
      await pw(link.locator('img[src*="/brand/jaryan-ma-mark-cream"]')).toHaveAttribute("alt", "جریان ما");
      const box = (await link.boundingBox())!;
      expect(box.width, `${device.name}: touch width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${device.name}: touch height`).toBeGreaterThanOrEqual(44);
      // nothing sits on top of it: the element at its centre is the logo itself
      expect(await link.evaluate((a) => { const r = a.getBoundingClientRect(); return a.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `${device.name}: nothing covers the logo`).toBe(true);
      // pointer: tap on a phone, click on a desktop
      if (device.tap) await link.tap();
      else await link.click();
      await page.waitForURL(`${url}/`);
      await pw(page.getByRole("heading", { level: 1 })).toContainText("هنر");
      // keyboard: from another page, Tab reaches the logo link (after the skip link), it shows a focus ring, Enter goes home
      await page.goto(`${url}/category/ceramics`, { waitUntil: "networkidle" });
      let reached = false;
      for (let i = 0; i < 6 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate((label) => document.activeElement?.getAttribute("aria-label") === label, LABEL);
      }
      expect(reached, `${device.name}: Tab reaches the logo link`).toBe(true);
      expect(await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle), `${device.name}: visible focus`).not.toBe("none");
      await page.keyboard.press("Enter");
      await page.waitForURL(`${url}/`);
      await pw(page.getByRole("heading", { level: 1 })).toContainText("هنر");
      await ctx.close();
    }
  });

  it("official logo: the real mark in header and footer, no square around it, original proportions, readable on a phone", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    const logos = await page.locator('img[src*="/brand/jaryan-ma-mark"]').evaluateAll((els) =>
      Promise.all(
        els.map(async (e) => {
          const img = e as HTMLImageElement;
          await img.decode();
          const r = img.getBoundingClientRect();
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          const g = c.getContext("2d")!;
          g.drawImage(img, 0, 0);
          const corners = [[1, 1], [c.width - 2, 1], [1, c.height - 2], [c.width - 2, c.height - 2]].map(([x, y]) => g.getImageData(x!, y!, 1, 1).data[3]!);
          return { place: img.closest("header") ? "header" : img.closest("footer") ? "footer" : "other", w: r.width, h: r.height, ratio: img.naturalWidth / img.naturalHeight, corners, alt: img.alt, src: img.currentSrc };
        }),
      ),
    );
    const header = logos.find((l) => l.place === "header");
    const footer = logos.find((l) => l.place === "footer");
    expect(header, "the header shows the logo").toBeTruthy();
    expect(footer, "the footer shows the logo").toBeTruthy();
    expect(header!.h, "recognisable on a phone").toBeGreaterThanOrEqual(56);
    expect(footer!.h).toBeGreaterThan(header!.h);
    for (const l of logos) {
      expect(Math.abs(l.w / l.h - 702 / 996), "original proportions").toBeLessThan(0.02);
      expect(Math.abs(l.ratio - 702 / 996), "the file keeps the original proportions").toBeLessThan(0.02);
      expect(l.corners, "transparent corners: no square background").toEqual([0, 0, 0, 0]);
      expect(l.alt).toBe("جریان ما");
    }
    // the logo sits on the brand burgundy, with the logo's own cream (colours sampled from the original file)
    const colours = await page.evaluate(() => ({ header: getComputedStyle(document.querySelector("header")!).backgroundColor, footer: getComputedStyle(document.querySelector("footer")!).backgroundColor }));
    expect(colours.header).toBe("rgb(94, 21, 38)");
    expect(colours.footer).toBe("rgb(94, 21, 38)");
    await ctx.close();
  });

  it("home: says what the gallery is (curated home decor and handicrafts) and does not limit itself to the first collections", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await pw(page.locator("#scope")).toContainText("دکوراسیون خانه و هنرهای دست‌ساز");
    for (const area of ["دکور دست‌ساز خانه", "هنر تزئینی", "سفال و سرامیک", "هنر نساجی", "اکسسوری دست‌ساز", "اشیای هنری یگانه"]) await pw(page.locator("#scope")).toContainText(area);
    await pw(page.locator("#scope")).toContainText("گسترش می‌یابند");
    expect(await page.title()).not.toMatch(/کیف|ماندالا/);
    await ctx.close();
  });

  it("product: facts come only from the data (sample products show labelled placeholders, never invented materials or sizes)", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    const facts = page.getByTestId("product-facts");
    await pw(facts).toBeVisible();
    for (const label of ["مواد", "ابعاد", "نگهداری", "ارسال"]) await pw(facts.getByText(label, { exact: true })).toBeVisible();
    expect(await facts.getByText("ثبت نشده").count()).toBe(4);
    expect(await facts.getByText("نمونه", { exact: true }).count()).toBe(4);
    expect(await facts.innerText()).not.toMatch(/سانتی|گرم|پنبه|خاک|چینی|شستشو/);
    await ctx.close();
  });
});

const isPhone = (width: number) => width < 768;

/** Records every window.scrollTo call the page makes (setup in these tests scrolls through scrollTop, so it never shows up here). */
const spyOnScrollTo = (page: Page) =>
  page.addInitScript(() => {
    const w = window as unknown as { __scrolls: string[] };
    w.__scrolls = [];
    const original = window.scrollTo.bind(window) as (...args: unknown[]) => void;
    window.scrollTo = ((...args: unknown[]) => {
      w.__scrolls.push(JSON.stringify(args[0]));
      return original(...args);
    }) as typeof window.scrollTo;
  });
const scrollCalls = (page: Page) => page.evaluate(() => (window as unknown as { __scrolls: string[] }).__scrolls);
const scrollDownTo = async (page: Page, y: number) => {
  await page.evaluate((top) => {
    document.scrollingElement!.scrollTop = top;
  }, y);
  await page.waitForFunction((top) => Math.abs(window.scrollY - top) < 2, y); // the page may scroll smoothly
};
/** Is the hero entirely below the sticky header, with nothing of it hidden? */
const heroBelowHeader = (page: Page) =>
  page.evaluate(() => {
    const header = document.querySelector("header")!.getBoundingClientRect();
    const hero = document.querySelector('section[aria-labelledby="hero-title"]')!.getBoundingClientRect();
    const h1 = document.querySelector("h1")!.getBoundingClientRect();
    return { scrollY: Math.round(window.scrollY), heroTop: Math.round(hero.top), headerBottom: Math.round(header.bottom), h1Top: Math.round(h1.top) };
  });
const LOGO = "جریان ما، صفحهٔ اصلی";

describe("the logo on the home page: scroll to the top", () => {
  it("a tap scrolls smoothly to the top, stays on /, and works from the keyboard", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await spyOnScrollTo(page);
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    const logo = page.locator("header").getByRole("link", { name: LOGO });
    await scrollDownTo(page, 1500);
    await logo.tap();
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    expect(page.url()).toBe(`${url}/`);
    expect(await scrollCalls(page), "an animated scroll was requested").toContain(JSON.stringify({ top: 0, left: 0, behavior: "smooth" }));
    // the keyboard does the same: focus stays on the link, Enter scrolls up
    await scrollDownTo(page, 1200);
    await logo.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    await pw(logo).toBeFocused();
    expect(page.url()).toBe(`${url}/`);
    await ctx.close();
  });

  it("with reduced motion the jump is instant (no animation is requested)", async () => {
    const ctx = await phone({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await spyOnScrollTo(page);
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await scrollDownTo(page, 1500);
    await page.locator("header").getByRole("link", { name: LOGO }).tap();
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 600 });
    const calls = await scrollCalls(page);
    expect(calls.some((c) => c.includes('"smooth"')), "no smooth scrolling under reduced motion").toBe(false);
    expect(calls).toContain(JSON.stringify({ top: 0, left: 0, behavior: "auto" }));
    await ctx.close();
  });

  it("a #section in the address is dropped, a modified click is left to the browser, and a desktop click works too", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/#featured`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.scrollY > 100);
    await page.locator("header").getByRole("link", { name: LOGO }).tap();
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    expect(new URL(page.url()).hash, "the #featured is gone").toBe("");
    // ctrl/cmd/shift-click and middle-click are not intercepted (they open a new tab in a real browser)
    const prevented = await page.locator("header").getByRole("link", { name: LOGO }).evaluate((a) => {
      const e = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 });
      a.addEventListener("click", (ev) => ev.preventDefault(), { once: true, capture: false }); // keep the test page where it is
      let seen = false;
      a.addEventListener("click", (ev) => { seen = ev.defaultPrevented; }, { once: true, capture: true });
      a.dispatchEvent(e);
      return seen;
    });
    expect(prevented, "the logo handler did not claim a ctrl-click").toBe(false);
    await ctx.close();
    const desktop = await phone({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });
    const dpage = await desktop.newPage();
    await dpage.goto(`${url}/`, { waitUntil: "networkidle" });
    await scrollDownTo(dpage, 1500);
    await dpage.locator("header").getByRole("link", { name: LOGO }).click();
    await dpage.waitForFunction(() => window.scrollY === 0, null, { timeout: 5000 });
    expect(dpage.url()).toBe(`${url}/`);
    await desktop.close();
  });
});

describe("arriving at the home page from another page", () => {
  it.each([
    ["a collection page", "/category/ceramics"],
    ["a product page", "/products/demo-blue-vase"],
    ["the cart", "/cart"],
  ])("from %s (scrolled down) the logo lands on the top of the home page, hero fully below the header", async (_name, path) => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
    await scrollDownTo(page, Math.min(900, await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)));
    await page.locator("header").getByRole("link", { name: LOGO }).tap();
    await page.waitForURL(`${url}/`);
    await page.waitForTimeout(700); // any late scroll adjustment would have happened by now
    const at = await heroBelowHeader(page);
    expect(at.scrollY, `${path}: starts at the top`).toBe(0);
    expect(at.heroTop, `${path}: the hero starts right under the header`).toBeGreaterThanOrEqual(at.headerBottom - 1);
    expect(at.h1Top, `${path}: the heading is not hidden by the header`).toBeGreaterThan(at.headerBottom);
    await ctx.close();
  });

  it("the same after in-app navigation (tap a collection, scroll, tap the logo), via the tab bar, and via the breadcrumb", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await page.locator('#collections a[href^="/category/"]').first().tap();
    await page.waitForURL(/\/category\//);
    await scrollDownTo(page, 500);
    await page.locator("header").getByRole("link", { name: LOGO }).tap();
    await page.waitForURL(`${url}/`);
    await page.waitForTimeout(700);
    expect((await heroBelowHeader(page)).scrollY, "after a collection").toBe(0);
    // tab bar "خانه" from a scrolled product page
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    await scrollDownTo(page, 800);
    await page.getByRole("navigation", { name: "پیمایش سریع" }).getByRole("link", { name: "خانه" }).tap();
    await page.waitForURL(`${url}/`);
    await page.waitForTimeout(700);
    expect((await heroBelowHeader(page)).scrollY, "via the tab bar").toBe(0);
    // breadcrumb "خانه" on a product page
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    await page.getByRole("navigation", { name: /مسیر|breadcrumb/i }).getByRole("link", { name: "خانه" }).tap();
    await page.waitForURL(`${url}/`);
    await page.waitForTimeout(700);
    expect((await heroBelowHeader(page)).scrollY, "via the breadcrumb").toBe(0);
    await ctx.close();
  });

  it("what must stay untouched: a link to a #section, and back/forward", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await spyOnScrollTo(page);
    // menu link to /#collections from a product page: the section is brought into view, the page is NOT sent to the top
    await page.goto(`${url}/products/demo-blue-vase`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "باز کردن منو" }).tap();
    await page.locator("#mobile-menu").getByRole("link", { name: "مجموعه‌ها" }).tap();
    await page.waitForURL(`${url}/#collections`);
    await page.waitForFunction(() => window.scrollY > 50);
    await page.waitForTimeout(700);
    const section = await page.locator("#collections").boundingBox();
    expect(section!.y, "#collections is in view").toBeLessThan(400);
    expect((await scrollCalls(page)).some((c) => c.includes('"instant"')), "the home reset did not run for a #section link").toBe(false);
    // back/forward: the browser's own scroll restoration is not overridden
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    await scrollDownTo(page, 900);
    await page.locator('#featured a[href^="/products/"]').first().tap();
    await page.waitForURL(/\/products\//);
    const before = (await scrollCalls(page)).length;
    // a slow phone (or a busy CI machine) lets the router finish before event listeners run: the reset must not depend on that order
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.goBack();
    await page.waitForURL(`${url}/`);
    await page.waitForTimeout(700);
    expect((await scrollCalls(page)).slice(before).some((c) => c.includes('"instant"')), "going back did not force the top").toBe(false);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await ctx.close();
  });
});

describe("the mobile viewport", () => {
  it("every storefront page ships the viewport tag, so a phone lays it out at its own width (not a 980px desktop layout)", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    for (const path of ["/", "/category/ceramics", "/products/demo-blue-vase", "/cart", "/checkout", "/orders", "/404.html"]) {
      await page.goto(`${url}${path}`, { waitUntil: "domcontentloaded" });
      expect(await page.locator('meta[name="viewport"]').getAttribute("content"), path).toBe("width=device-width, initial-scale=1");
      expect(await page.evaluate(() => window.innerWidth), `${path} is laid out at the phone's width`).toBe(412);
      expect(await page.locator('meta[name="viewport"]').count(), `${path}: exactly one viewport tag`).toBe(1);
    }
    await ctx.close();
  });
});

describe("other screen sizes", () => {
  it.each([360, 412, 600, 768, 980, 1024, 1280])("home and product fit at %ipx wide (tab bar and hamburger only below 768px)", async (width) => {
    const ctx = await phone({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
    const page = await ctx.newPage();
    for (const path of ["/", "/products/demo-mandala-sunburst"]) {
      await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${path} at ${width}px`).toBeLessThanOrEqual(0);
      await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
      const tabbar = page.getByRole("navigation", { name: "پیمایش سریع" });
      // below 768px: tab bar + hamburger, no desktop navigation; from 768px (and in a phone's "desktop site" mode, 980px): the reverse
      const menuButton = page.getByRole("button", { name: "باز کردن منو" });
      const desktopNav = page.locator("header").getByRole("navigation", { name: "منوی اصلی" });
      if (width < 768) {
        await pw(tabbar).toBeVisible();
        await pw(menuButton).toBeVisible();
        await pw(desktopNav).toBeHidden();
      } else {
        await pw(tabbar).toBeHidden();
        await pw(menuButton).toBeHidden();
        await pw(desktopNav).toBeVisible();
      }
      if (isPhone(width)) expect(await page.evaluate(() => window.innerWidth), "a phone lays the page out at its own width").toBe(width);
    }
    await ctx.close();
  });
});

describe("what the redesign ships", () => {
  it("loads nothing from another host (every font and picture is our own file)", () => {
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

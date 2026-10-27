import { expect as pw } from "playwright/test";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import type { Server } from "node:http";
import { join, relative } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * The two DESIGN CONCEPTS (public/design-preview) as they are deployed (inside the real static export), on an Android phone (412x915):
 * every page opens, fits the screen, is accessible (axe WCAG 2.x A/AA), loads only its own files and fonts, labels all content as sample,
 * invents no price, is never indexable, leaves the real storefront untouched, and its mobile interactions work.
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

async function phone(): Promise<BrowserContext> {
  const ctx = await browser.newContext(ANDROID);
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

const PAGES: Array<{ name: string; path: string; concept: "a" | "b" | null }> = [
  { name: "chooser", path: "/design-preview/", concept: null },
  { name: "A home", path: "/design-preview/concept-a/", concept: "a" },
  { name: "A product (mandala)", path: "/design-preview/concept-a/product?c=mandala&n=1", concept: "a" },
  { name: "A product (tote)", path: "/design-preview/concept-a/product?c=tote&n=2", concept: "a" },
  { name: "A product (pottery)", path: "/design-preview/concept-a/product?c=pottery&n=1", concept: "a" },
  { name: "B home", path: "/design-preview/concept-b/", concept: "b" },
  { name: "B product (mandala)", path: "/design-preview/concept-b/product?c=mandala&n=1", concept: "b" },
  { name: "B product (tote)", path: "/design-preview/concept-b/product?c=tote&n=2", concept: "b" },
  { name: "B product (pottery)", path: "/design-preview/concept-b/product?c=pottery&n=1", concept: "b" },
];

describe("design concepts on an Android phone (412x915)", () => {
  it.each(PAGES)("$name: fits the screen, Persian RTL, sample-labelled, not indexable, accessible, assets load", async ({ path, concept }) => {
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
        text: document.body.innerText,
        brokenImages: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.src),
        unlabelledImages: imgs.filter((i) => !i.hasAttribute("alt")).map((i) => i.src),
        display: document.fonts.check('700 20px "Markazi Text"') || document.fonts.check('800 20px "Baloo Bhaijaan 2"'),
        body: document.fonts.check('400 16px "Vazirmatn"'),
      };
    });
    expect(facts.overflow, "no sideways scrolling").toBeLessThanOrEqual(0);
    expect(facts.lang).toBe("fa");
    expect(facts.dir).toBe("rtl");
    expect(facts.robots).toContain("noindex");
    expect(facts.h1, "exactly one h1").toBe(1);
    expect(facts.text).toContain("نمونه");
    expect(facts.text, "no invented price").not.toMatch(/[\d۰-۹][\d۰-۹,٬.]*\s*(تومان|ریال)/);
    expect(facts.brokenImages).toEqual([]);
    expect(facts.unlabelledImages).toEqual([]);
    if (concept) expect(facts.display, "the concept's display font is loaded from our own files").toBe(true);
    expect(facts.body).toBe(true);
    expect(await axeViolations(page)).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it("every product page labels its pictures as temporary placeholders", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    for (const { path } of PAGES.filter((p) => p.path.includes("product"))) {
      await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
      const slides = await page.locator("[data-slide]").count();
      const tags = await page.locator("[data-slide] .ph").count();
      expect(slides, path).toBe(3);
      expect(tags, path).toBe(3);
    }
    await ctx.close();
  });

  it("the primary touch targets are at least 44px", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const targets: Record<string, string[]> = {
      "/design-preview/concept-a/product?c=mandala": ["header button", ".btn", ".opt", ".dots button", "summary"],
      "/design-preview/concept-b/product?c=mandala": ["header button", ".btn", ".opt", ".dots button", ".tabs [role=tab]", ".switch a"],
      "/design-preview/concept-b/": [".tabbar a", ".tabbar button", ".pill-btn", ".btn"],
    };
    for (const [path, selectors] of Object.entries(targets)) {
      await page.goto(`${url}${path}`, { waitUntil: "networkidle" });
      for (const selector of selectors) {
        const boxes = await page.locator(selector).evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; }));
        expect(boxes.length, `${path} ${selector}`).toBeGreaterThan(0);
        for (const b of boxes) expect(Math.min(b.w, b.h), `${path} ${selector}`).toBeGreaterThanOrEqual(43.5);
      }
    }
    await ctx.close();
  });
});

describe("mobile interactions", () => {
  it("concept A: the index menu opens and closes, the gallery swipes by dots, the sticky buy bar appears after the main button scrolls away, accordions open", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/design-preview/concept-a/product?c=pottery&n=1`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "باز کردن فهرست" }).tap();
    await pw(page.getByRole("dialog")).toBeVisible();
    await pw(page.getByRole("link", { name: /دیدن مفهوم ب/ })).toBeVisible();
    await page.getByRole("button", { name: "بستن فهرست" }).tap();
    await pw(page.getByRole("dialog")).toBeHidden();

    await page.getByRole("button", { name: "تصویر ۳" }).tap();
    await pw(page.locator("[data-counter]")).toHaveText(/۳ از ۳/, { timeout: 5000 });
    await pw(page.locator("[data-sticky]")).not.toHaveClass(/is-visible/);
    await page.locator("[data-cta]").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 700));
    await pw(page.locator("[data-sticky]")).toHaveClass(/is-visible/);

    await page.getByText("جزئیات ساخت").first().tap();
    await pw(page.getByText("سفالگری دست‌ساز").first()).toBeVisible();
    await page.getByRole("button", { name: "افزودن به سبد", exact: true }).first().tap();
    await pw(page.getByRole("status")).toContainText("فعال نیست");
    await ctx.close();
  });

  it("concept B: the category sheet opens from the tab bar, options and tabs are selectable, the cart tap explains itself", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/design-preview/concept-b/`, { waitUntil: "networkidle" });
    await page.getByRole("navigation", { name: "پیمایش اصلی" }).getByRole("button", { name: "دسته‌ها" }).tap();
    await pw(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("link", { name: /سفال و سرامیک/ }).tap();
    await page.waitForURL(/product\?c=pottery/);
    await pw(page.getByRole("heading", { level: 1 })).toContainText("اثر سفالی");

    await page.getByRole("radio", { name: "کاسه" }).tap();
    await pw(page.getByRole("radio", { name: "کاسه" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("tab", { name: "جزئیات" }).tap();
    await pw(page.getByRole("tabpanel")).toContainText("سفالگری دست‌ساز");
    await page.getByRole("tab", { name: "نگهداری" }).tap();
    await pw(page.getByRole("tabpanel")).toContainText("ثبت نشده");
    await page.getByRole("button", { name: "افزودن به سبد" }).tap();
    await pw(page.getByRole("status")).toContainText("فعال نیست");

    // the same page, another category, via the template switcher: layout adapts, the title follows
    await page.getByRole("link", { name: "کیف پارچه‌ای نقاشی‌دست" }).first().tap();
    await page.waitForURL(/product\?c=tote/);
    await pw(page.getByRole("heading", { level: 1 })).toContainText("کیف پارچه‌ای");
    await ctx.close();
  });

  it("both home pages reach their product pages by tapping a card", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    for (const concept of ["a", "b"]) {
      await page.goto(`${url}/design-preview/concept-${concept}/`, { waitUntil: "networkidle" });
      await page.locator('a[href*="/product?c="]').nth(concept === "a" ? 3 : 4).scrollIntoViewIfNeeded();
      await page.locator("#works a[href*='/product?c=']").first().tap();
      await page.waitForURL(/product\?c=/);
      await pw(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    await ctx.close();
  });
});

describe("what ships with the design previews", () => {
  it("loads nothing from another host (fonts and images are our own files)", () => {
    expect([...requested].filter((h) => !h.startsWith("127.0.0.1")), "foreign hosts requested").toEqual([]);
  });

  it("only links to its own pages and the real Instagram account; no scripts or styles from elsewhere", () => {
    const root = join(dir, "design-preview");
    const offenders: string[] = [];
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
    for (const file of walk(root).filter((f) => /\.(html|css|js|svg)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/https?:\/\/[^\s"')<>]+/g)) {
        if (!/^https?:\/\/(instagram\.com\/jaryan\.ma|www\.w3\.org\/)/.test(m[0])) offenders.push(`${relative(dir, file)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("is never indexable (header rule) and ships the font licences", () => {
    expect(readFileSync(join(dir, "_headers"), "utf8")).toMatch(/\/design-preview\/\*\s+X-Robots-Tag: noindex, nofollow/);
    const licences = readdirSync(join(dir, "design-preview/assets/fonts/licenses"));
    expect(licences.sort()).toEqual(["BalooBhaijaan2-OFL.txt", "MarkaziText-OFL.txt", "Vazirmatn-OFL.txt"]);
  });

  it("leaves the real storefront untouched: it does not link to the previews and is still closed to search engines", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${url}/`, { waitUntil: "networkidle" });
    expect(await page.locator('a[href*="design-preview"]').count()).toBe(0);
    await pw(page.getByRole("heading", { level: 1 })).toHaveText("اینجا هنر در جریان است");
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
    const sitemap = await (await fetch(`${url}/sitemap.xml`)).text();
    expect(sitemap).not.toContain("design-preview");
    await ctx.close();
  });
});

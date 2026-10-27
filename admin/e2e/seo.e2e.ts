import { expect as pw } from "playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildStorefront, serveStatic } from "./storefront";

/**
 * SEO output in a REAL browser at Android phone size (412x915, touch, mobile user agent). Two static builds of the real storefront:
 *  - LAUNCHED, from a catalogue created through the real backend stack (PostgreSQL via Prisma + snapshot publisher): metadata, canonicals,
 *    structured data (Product/Offer/BreadcrumbList/CollectionPage/Organization), sold-out handling, robots.txt, sitemap.xml, internal links
 *    (crawlability from the home page alone), image loading hints, layout stability, no horizontal scroll;
 *  - CLOSED, with the built-in sample content: nothing indexable, no sitemap entries, no Product data.
 * The pages are pre-rendered HTML, so what the browser sees at load is also what a crawler reads.
 */
const ORIGIN = "https://seo-check.example";
const MEDIA = "https://media.fixture.example";
// 1x1 WebP-less: a tiny valid PNG is enough to make the <img> load and be measured.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ANDROID = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true, locale: "fa-IR", userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36" } as const;

interface Site { dir: string; server: Server; url: string }
let browser: Browser;
let launched: Site;
let closed: Site;
let snapshot: string;
const hosts = new Set<string>();

async function serve(env: Record<string, string>): Promise<Site> {
  const dir = buildStorefront(env);
  return { dir, ...(await serveStatic(dir)) };
}

beforeAll(async () => {
  snapshot = mkdtempSync(join(tmpdir(), "jm-seo-e2e-snapshot-"));
  execFileSync("npx", ["tsx", "scripts/seo/generate-fixture.ts", snapshot], { cwd: join(import.meta.dirname, "../.."), stdio: "pipe" });
  launched = await serve({ NEXT_PUBLIC_SITE_URL: ORIGIN, CATALOG_SNAPSHOT_DIR: snapshot, SEO_ALLOW_INDEXING: "true" });
  closed = await serve({ NEXT_PUBLIC_SITE_URL: ORIGIN });
  browser = await chromium.launch();
}, 900_000);

afterAll(async () => {
  await browser?.close();
  for (const s of [launched, closed]) {
    s?.server.closeAllConnections();
    await new Promise((r) => (s ? s.server.close(r) : r(undefined)));
    if (s) rmSync(s.dir, { recursive: true, force: true });
  }
  if (snapshot) rmSync(snapshot, { recursive: true, force: true });
});

async function phone(): Promise<BrowserContext> {
  const ctx = await browser.newContext(ANDROID);
  ctx.on("request", (r) => {
    if (/^https?:/.test(r.url())) hosts.add(new URL(r.url()).host);
  });
  // The fixture's image URLs point at a bucket that does not exist: serve a tiny image so loading and layout can be measured.
  await ctx.route(`${MEDIA}/**`, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  return ctx;
}

interface Head {
  title: string | null;
  description: string | null;
  canonical: string | null;
  robots: string | null;
  ogTitle: string | null;
  ogUrl: string | null;
  viewport: string | null;
  lang: string | null;
  dir: string | null;
  h1: number;
  jsonLd: Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  badJsonLd: number;
  imgs: Array<{ alt: string | null; loading: string | null; priority: string | null; src: string }>;
  links: string[];
  scrollOverflow: number;
}
const head = (page: Page): Promise<Head> =>
  page.evaluate(() => {
    const meta = (n: string) => document.querySelector(`meta[name="${n}"]`)?.getAttribute("content") ?? null;
    const prop = (n: string) => document.querySelector(`meta[property="${n}"]`)?.getAttribute("content") ?? null;
    const ld: Array<Record<string, unknown>> = [];
    let bad = 0;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        ld.push(JSON.parse(s.textContent ?? ""));
      } catch {
        bad++;
      }
    }
    return {
      title: document.title || null,
      description: meta("description"),
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
      robots: meta("robots"),
      ogTitle: prop("og:title"),
      ogUrl: prop("og:url"),
      viewport: meta("viewport"),
      lang: document.documentElement.lang,
      dir: document.documentElement.dir,
      h1: document.querySelectorAll("h1").length,
      jsonLd: ld as Array<Record<string, any>>, // eslint-disable-line @typescript-eslint/no-explicit-any
      badJsonLd: bad,
      imgs: [...document.querySelectorAll("img")].map((i) => ({ alt: i.getAttribute("alt"), loading: i.getAttribute("loading"), priority: i.getAttribute("fetchpriority"), src: i.getAttribute("src") ?? "" })),
      links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? ""),
      scrollOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

/** Layout shift accumulated while the page loads and is scrolled once (a crawler-visible quality signal and a real-user one). */
async function layoutShift(page: Page): Promise<number> {
  await page.evaluate(() => {
    (window as unknown as { __cls: number }).__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 30));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
  return page.evaluate(() => (window as unknown as { __cls: number }).__cls);
}

const local = (site: Site, url: string) => url.replace(ORIGIN, site.url);
const sitemapUrls = async (site: Site) => [...(await (await fetch(`${site.url}/sitemap.xml`)).text()).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
const robotsTxt = async (site: Site) => (await fetch(`${site.url}/robots.txt`)).text();
const byType = (h: Head, type: string) => h.jsonLd.filter((b) => b["@type"] === type);

describe("SEO output of the launched site in a real browser (Android phone)", () => {
  it("robots.txt allows the site, closes the private shopping pages, and names the sitemap", async () => {
    const robots = await robotsTxt(launched);
    const lines = robots.split("\n").map((l) => l.trim());
    expect(lines).toContain("Allow: /");
    for (const p of ["/cart", "/checkout", "/order", "/orders", "/product?", "/api/"]) expect(lines, p).toContain(`Disallow: ${p}`);
    expect(lines).not.toContain("Disallow: /");
    expect(lines.some((l) => /^Disallow: \/products/.test(l))).toBe(false);
    expect(lines).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it("sitemap.xml: valid, unique, same-origin, no invented dates, only real indexable pages (no draft, no sample), and every URL really opens", async () => {
    const xml = await (await fetch(`${launched.url}/sitemap.xml`)).text();
    expect(xml).toMatch(/^<\?xml[^>]*\?>\s*<urlset/);
    expect(xml).not.toMatch(/<lastmod>|<priority>|<changefreq>/);
    const urls = await sitemapUrls(launched);
    expect(urls.length).toBe(new Set(urls).size);
    expect(urls.every((u) => u.startsWith(`${ORIGIN}/`))).toBe(true);
    expect(urls).toContain(`${ORIGIN}/`);
    expect(urls.filter((u) => u.includes("/products/"))).toHaveLength(6); // 7 products were created, one is a draft
    expect(urls.join("\n")).not.toContain(encodeURIComponent("پیش‌نویس"));
    expect(urls.some((u) => /demo-/.test(u))).toBe(false);
    const ctx = await phone();
    const page = await ctx.newPage();
    for (const u of urls) {
      const response = await page.goto(local(launched, u));
      expect(response?.status(), u).toBe(200);
    }
    await ctx.close();
  });

  it("every page in the sitemap has the right head: unique title and description, canonical = its own URL, indexable, one h1, Open Graph, mobile viewport, Persian RTL", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const u of await sitemapUrls(launched)) {
      await page.goto(local(launched, u));
      const h = await head(page);
      const where = decodeURIComponent(u);
      expect(h.title, where).toBeTruthy();
      expect(h.title!.length, where).toBeLessThanOrEqual(90); // 70 + " | جریان ما"
      expect(h.description, where).toBeTruthy();
      expect(h.description!.length, where).toBeLessThanOrEqual(160);
      expect(titles.get(h.title!), `duplicate title: ${where}`).toBeUndefined();
      expect(descriptions.get(h.description!), `duplicate description: ${where}`).toBeUndefined();
      titles.set(h.title!, u);
      descriptions.set(h.description!, u);
      // Next writes the site root without its trailing slash; both spell the same URL.
      expect(decodeURI(h.canonical ?? "").replace(/\/$/, ""), where).toBe(decodeURI(u).replace(/\/$/, ""));
      expect(h.robots ?? "", where).not.toMatch(/noindex/);
      expect(h.h1, where).toBe(1);
      expect(h.ogTitle, where).toBeTruthy();
      expect(h.viewport, where).toContain("width=device-width");
      expect([h.lang, h.dir], where).toEqual(["fa", "rtl"]);
      expect(h.badJsonLd, where).toBe(0);
      expect(h.scrollOverflow, `horizontal scroll on ${where}`).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });

  it("structured data: Organization + WebSite on the home page; Product + Offer + BreadcrumbList on products; CollectionPage on categories; nothing unverifiable", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${launched.url}/`);
    const home = await head(page);
    expect(byType(home, "Organization")).toHaveLength(1);
    expect(byType(home, "WebSite")).toHaveLength(1);
    expect(JSON.stringify(home.jsonLd)).not.toMatch(/telephone|address|email/);

    const urls = await sitemapUrls(launched);
    const products = urls.filter((u) => u.includes("/products/"));
    const seen = new Map<string, Head>();
    for (const u of products) {
      await page.goto(local(launched, u));
      const h = await head(page);
      seen.set(decodeURIComponent(u.split("/products/")[1]!), h);
      const [product] = byType(h, "Product");
      expect(product, u).toBeTruthy();
      expect(product!.url).toBe(u);
      for (const bad of ["aggregateRating", "review", "brand", "gtin", "shippingDetails"]) expect(product, `${u}: ${bad}`).not.toHaveProperty(bad);
      const offer = product!.offers;
      if (offer) {
        expect(offer.priceCurrency).toBe("IRR");
        expect(String(offer.price ?? offer.lowPrice)).toMatch(/^\d+$/);
        expect(offer.availability).toMatch(/^https:\/\/schema\.org\/(InStock|OutOfStock|MadeToOrder)$/);
      }
      const [crumbs] = byType(h, "BreadcrumbList");
      expect(crumbs!.itemListElement.map((c: any) => c.position)).toEqual(crumbs!.itemListElement.map((_: unknown, i: number) => i + 1)); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(crumbs!.itemListElement.at(-1).item).toBe(u);
    }
    // each product state maps to the right availability
    const avail = (slug: string) => byType(seen.get(slug)!, "Product")[0]!.offers.availability as string;
    expect(avail("دیوارکوب-بافته-پاییزی")).toBe("https://schema.org/InStock");
    expect(avail("رانر-سفارشی")).toBe("https://schema.org/MadeToOrder");
    expect(avail("اثر-فروخته-شده")).toBe("https://schema.org/OutOfStock");
    expect(byType(seen.get("کوسن-بافته")!, "Product")[0]!.offers["@type"]).toBe("AggregateOffer"); // two priced sizes

    for (const u of urls.filter((x) => x.includes("/category/"))) {
      await page.goto(local(launched, u));
      const h = await head(page);
      const [collection] = byType(h, "CollectionPage");
      expect(collection, u).toBeTruthy();
      const listed = collection!.mainEntity.itemListElement.map((i: any) => i.url as string); // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(listed.length).toBe(collection!.mainEntity.numberOfItems);
      expect(listed.every((x: string) => urls.includes(x))).toBe(true);
      // the visible product cards are exactly the listed ones
      const visible = await page.locator('main ul a[href^="/products/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(new Set(visible.map((v) => `${ORIGIN}${v}`))).toEqual(new Set(listed));
      expect(byType(h, "BreadcrumbList")).toHaveLength(1);
    }
    await ctx.close();
  });

  it("a sold-out piece keeps its page: indexable, honestly marked OutOfStock and 'ناموجود', linking to pieces that can still be bought", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${launched.url}/products/${encodeURIComponent("اثر-فروخته-شده")}`);
    const h = await head(page);
    expect(h.robots ?? "").not.toMatch(/noindex/);
    expect(byType(h, "Product")[0]!.offers.availability).toBe("https://schema.org/OutOfStock");
    await pw(page.getByRole("main")).toContainText("ناموجود");
    await pw(page.getByTestId("related-products")).toBeVisible();
    const related = await page.getByTestId("related-products").locator('a[href^="/products/"]').evaluateAll((as) => as.map((a) => decodeURIComponent(a.getAttribute("href") ?? "")));
    expect(related.length).toBeGreaterThan(0);
    expect(related.every((r) => r !== "/products/اثر-فروخته-شده")).toBe(true);
    expect(related[0]).not.toBe("/products/اثر-فروخته-شده");
    // a purchasable piece's page links onward, too
    await page.goto(`${launched.url}/products/${encodeURIComponent("دیوارکوب-بافته-پاییزی")}`);
    await pw(page.getByTestId("related-products")).toBeVisible();
    await ctx.close();
  });

  it("a draft product has no page at all", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    const response = await page.goto(`${launched.url}/products/${encodeURIComponent("پیش-نویس-نباید-دیده-شود")}`);
    expect(response?.status()).toBe(404);
    await ctx.close();
  });

  it("crawlability: following ONLY ordinary links from the home page (no script, no sitemap) reaches every category and product", async () => {
    const urls = await sitemapUrls(launched);
    const known = new Set<string>();
    const queue = ["/"];
    while (queue.length > 0) {
      const path = queue.shift()!;
      if (known.has(path)) continue;
      known.add(path);
      const html = await (await fetch(`${launched.url}${decodeURI(path)}`)).text(); // raw HTML: what a crawler reads before any JavaScript
      for (const m of html.matchAll(/<a [^>]*href="(\/(?:products|category)\/[^"#?]+)"/g)) queue.push(m[1]!);
    }
    const reached = new Set([...known].map((p) => `${ORIGIN}${p === "/" ? "/" : p}`));
    for (const u of urls) expect(reached, decodeURIComponent(u)).toContain(u);
  });

  it("private shopping pages are noindex and blocked in robots.txt", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    for (const p of ["/cart", "/checkout", "/order", "/orders", "/product"]) {
      await page.goto(`${launched.url}${p}`);
      expect((await head(page)).robots, p).toMatch(/noindex/);
    }
    await ctx.close();
  });

  it("images: every one has alt text; the first product photo loads eagerly with high priority, the rest lazily; pages do not jump while loading", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    for (const slug of ["دیوارکوب-بافته-پاییزی", "ماکرومه-قوسی", "اثر-فروخته-شده"]) {
      await page.goto(`${launched.url}/products/${encodeURIComponent(slug)}`);
      const h = await head(page);
      const photos = h.imgs.filter((i) => i.src.startsWith(MEDIA));
      expect(photos.length, slug).toBeGreaterThan(0);
      for (const img of h.imgs) expect(img.alt, `${slug}: ${img.src}`).toBeTruthy();
      expect(photos[0]!.priority, slug).toBe("high");
      expect(photos[0]!.loading, slug).not.toBe("lazy");
      for (const img of photos.slice(1)) expect(img.loading, slug).toBe("lazy");
      expect(await layoutShift(page), `layout shift on ${slug}`).toBeLessThan(0.1);
    }
    for (const path of ["/", `/category/${encodeURIComponent("دیوارکوب")}`]) {
      await page.goto(`${launched.url}${path}`);
      expect(await layoutShift(page), `layout shift on ${path}`).toBeLessThan(0.1);
      const h = await head(page);
      expect(h.scrollOverflow, path).toBeLessThanOrEqual(0);
    }
    await ctx.close();
  });

  it("the home page offers plain links to the catalogue (categories and products) in the server-rendered HTML", async () => {
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${launched.url}/`);
    const nav = page.getByTestId("catalog-links");
    await pw(nav).toBeVisible();
    await pw(nav.getByRole("link", { name: /دیوارکوب بافته پاییزی/ })).toBeVisible();
    expect(await nav.locator('a[href^="/category/"]').count()).toBeGreaterThanOrEqual(2);
    const box = await nav.getByRole("link").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44); // a comfortable touch target
    await ctx.close();
  });
});

describe("SEO output of the closed site (sample content, nothing launched)", () => {
  it("robots.txt disallows everything, the sitemap is empty, every page is noindex and carries no Product data", async () => {
    expect((await robotsTxt(closed)).split("\n").map((l) => l.trim())).toContain("Disallow: /");
    expect(await sitemapUrls(closed)).toEqual([]);
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${closed.url}/`);
    expect((await head(page)).robots).toMatch(/noindex/);
    const productLinks = await page.locator('a[href^="/products/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
    // The sample content links to its own pages: all of them must be non-indexable.
    const sample = productLinks.length > 0 ? productLinks : ["/products/demo-1"];
    for (const href of sample.slice(0, 4)) {
      const response = await page.goto(`${closed.url}${decodeURI(href)}`);
      if (response?.status() !== 200) continue;
      const h = await head(page);
      expect(h.robots, href).toMatch(/noindex/);
      expect(byType(h, "Product"), href).toHaveLength(0);
      expect(byType(h, "BreadcrumbList"), href).toHaveLength(0);
      expect(h.canonical === null || h.canonical.startsWith(ORIGIN), href).toBe(true);
    }
    await ctx.close();
  });
});

describe("nothing foreign", () => {
  it("every request of every test went to the local server (the fixture's image host was answered locally)", () => {
    const foreign = [...hosts].filter((h) => !h.startsWith("127.0.0.1:") && h !== "media.fixture.example");
    expect(foreign).toEqual([]);
  });
});

import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCatalogSeo } from "../../src/seo/catalog-seo";
import { catalog, product } from "../../src/seo/fixtures";
import { parseOverrides } from "../../src/seo/overrides-file";
import { directoryFetcher, auditSite, httpFetcher, jsonLdOf, type FetchedPage, type PageFetcher } from "./tech-audit";
import { COOLDOWN_DAYS, propose, readLedger, rejectReason, writeProposalFiles, type LedgerEntry } from "./proposals";
import type { LowCtrPage } from "./analysis";

const O = "https://jaryan.example.ir";
const enc = encodeURIComponent;

// ---------------- a tiny fake site ----------------
interface FakePage { html: string; status?: number; headers?: Record<string, string>; finalUrl?: string }
function fakeSite(pages: Record<string, FakePage | string>): PageFetcher {
  return {
    async fetch(url) {
      const p = pages[url.replace(O, "") || "/"];
      if (p === undefined) return { status: 404, headers: {}, body: "", finalUrl: url };
      const page = typeof p === "string" ? { html: p } : p;
      return { status: page.status ?? 200, headers: page.headers ?? {}, body: page.html, finalUrl: page.finalUrl ?? url } satisfies FetchedPage;
    },
  };
}
const ld = (...blocks: unknown[]) => blocks.map((b) => `<script type="application/ld+json">${JSON.stringify(b)}</script>`).join("");
const page = (o: { url: string; title?: string; description?: string; robots?: string; canonical?: string | null; h1?: number; img?: string; extra?: string; body?: string }) =>
  `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta name="viewport" content="width=device-width, initial-scale=1"/>` +
  `${o.title === undefined ? "<title>عنوان مناسب برای این صفحه</title>" : o.title ? `<title>${o.title}</title>` : ""}` +
  `${o.description === undefined ? `<meta name="description" content="${`توضیح کافی و یکتا برای صفحهٔ ${decodeURIComponent(o.url)} ${"با جزئیات ".repeat(4)}`.trim()}"/>` : o.description ? `<meta name="description" content="${o.description}"/>` : ""}` +
  `${o.robots ? `<meta name="robots" content="${o.robots}"/>` : ""}${o.canonical === null ? "" : `<link rel="canonical" href="${o.canonical ?? o.url}"/>`}<meta property="og:title" content="x"/></head>` +
  `<body>${"<h1>تیتر</h1>".repeat(o.h1 ?? 1)}${o.img ?? '<img src="/a.webp" alt="تصویر"/>'}<p>${o.body ?? "متن کافی ".repeat(40)}</p>${o.extra ?? ""}</body></html>`;

const ROBOTS_OK = `User-Agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\nDisallow: /order\nDisallow: /orders\nDisallow: /product?\nDisallow: /api/\n\nSitemap: ${O}/sitemap.xml`;
const sitemap = (...urls: string[]) => `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join("")}</urlset>`;
const P = `${O}/products/${enc("اثر-یک")}`;
const C = `${O}/category/${enc("دسته")}`;
const productLd = ld({ "@type": "Product", name: "اثر" }, { "@type": "BreadcrumbList", itemListElement: [] });

function healthySite(over: Record<string, FakePage | string> = {}) {
  return fakeSite({
    "/robots.txt": ROBOTS_OK,
    "/sitemap.xml": sitemap(`${O}/`, C, P),
    "/": page({ url: `${O}/`, title: "جریان ما | هنر دست‌ساز", extra: `<a href="${C}">دسته</a><a href="${P}">اثر</a>` }),
    [`/category/${enc("دسته")}`]: page({ url: C, title: "دستهٔ آثار بافته", extra: `<a href="${P}">اثر</a>` }),
    [`/products/${enc("اثر-یک")}`]: page({ url: P, title: "اثر یک – دسته", description: "توضیح یکتا برای این محصول که طول مناسبی دارد و درباره اثر است.", extra: productLd }),
    ...over,
  });
}
const audit = (fetcher: PageFetcher, expectIndexing = true) => auditSite({ origin: O, fetcher, date: "2026-11-10", expectIndexing });
const codes = async (fetcher: PageFetcher, expectIndexing = true) => (await audit(fetcher, expectIndexing)).issues.map((i) => i.code);

describe("technical audit", () => {
  it("a healthy launched site has no critical or warning problems", async () => {
    const r = await audit(healthySite());
    expect(r.pagesChecked).toBe(3);
    expect(r.issues.filter((i) => i.severity !== "info")).toEqual([]);
  });

  it("finds crawl-blocking mistakes: robots, sitemap, status codes", async () => {
    expect(await codes(healthySite({ "/robots.txt": "User-Agent: *\nDisallow: /" }))).toContain("robots_blocks_site");
    expect(await codes(healthySite({ "/robots.txt": ROBOTS_OK.replace(`Sitemap: ${O}/sitemap.xml`, "") }))).toContain("robots_no_sitemap");
    expect(await codes(healthySite({ "/robots.txt": ROBOTS_OK.replace("Disallow: /cart\n", "") }))).toContain("robots_private_open");
    expect(await codes(fakeSite({ "/sitemap.xml": sitemap(`${O}/`), "/": page({ url: `${O}/` }) }))).toContain("robots_missing");
    expect(await codes(healthySite({ "/sitemap.xml": sitemap() }))).toContain("sitemap_empty");
    expect(await codes(healthySite({ "/sitemap.xml": sitemap(`${O}/`, `${O}/`, "https://other.example/x") }))).toEqual(expect.arrayContaining(["sitemap_duplicate", "sitemap_foreign"]));
    expect(await codes(healthySite({ "/sitemap.xml": sitemap(`${O}/`, `${O}/products/gone`) }))).toContain("page_not_found");
    expect(await codes(healthySite({ [`/products/${enc("اثر-یک")}`]: { html: "", status: 500 } }))).toContain("page_server_error");
    expect(await codes(healthySite({ [`/products/${enc("اثر-یک")}`]: { html: page({ url: P }), finalUrl: `${O}/elsewhere` } }))).toContain("page_redirects");
  });

  it("finds indexing mistakes: noindex in the sitemap, wrong canonicals", async () => {
    const at = (html: string, headers?: Record<string, string>) => healthySite({ [`/products/${enc("اثر-یک")}`]: { html, ...(headers ? { headers } : {}) } });
    expect(await codes(at(page({ url: P, robots: "noindex, nofollow", extra: productLd })))).toContain("noindex_in_sitemap");
    expect(await codes(at(page({ url: P, extra: productLd }), { "x-robots-tag": "noindex" }))).toContain("x_robots_noindex");
    expect(await codes(at(page({ url: P, canonical: `${O}/other`, extra: productLd })))).toContain("canonical_mismatch");
    expect(await codes(at(page({ url: P, canonical: null, extra: productLd })))).toContain("canonical_missing");
  });

  it("finds on-page problems: titles, descriptions, headings, images, thin text", async () => {
    const at = (html: string) => healthySite({ [`/products/${enc("اثر-یک")}`]: html });
    expect(await codes(at(page({ url: P, title: "", extra: productLd })))).toContain("title_missing");
    expect(await codes(at(page({ url: P, title: "ا".repeat(90), extra: productLd })))).toContain("title_length");
    expect(await codes(at(page({ url: P, description: "", extra: productLd })))).toContain("description_missing");
    expect(await codes(at(page({ url: P, description: "کوتاه", extra: productLd })))).toContain("description_length");
    expect(await codes(at(page({ url: P, h1: 2, extra: productLd })))).toContain("h1_count");
    expect(await codes(at(page({ url: P, img: '<img src="/x.webp"/>', extra: productLd })))).toContain("image_alt_missing");
    expect(await codes(at(page({ url: P, body: "کم", extra: productLd })))).toContain("thin_content");
    expect(await codes(at(page({ url: P, extra: productLd }).replace('lang="fa"', 'lang="en"')))).toContain("lang_missing");
    expect(await codes(at(page({ url: P, extra: productLd }).replace(/<meta name="viewport"[^>]*>/, "")))).toContain("viewport_missing");
  });

  it("finds duplicate titles and descriptions across pages", async () => {
    const same = page({ url: C, title: "عنوان تکراری برای دو صفحه" });
    const r = await codes(healthySite({ [`/category/${enc("دسته")}`]: same, [`/products/${enc("اثر-یک")}`]: page({ url: P, title: "عنوان تکراری برای دو صفحه", extra: productLd }) }));
    expect(r).toContain("duplicate_title");
  });

  it("finds structured-data problems, including unverifiable fields", async () => {
    const at = (extra: string) => healthySite({ [`/products/${enc("اثر-یک")}`]: page({ url: P, extra }) });
    expect(await codes(at(""))).toContain("product_data_missing");
    expect(await codes(at(ld({ "@type": "Product", name: "x" })))).toContain("breadcrumb_missing");
    expect(await codes(at(`<script type="application/ld+json">{broken</script>`))).toContain("structured_data_invalid");
    for (const field of ["aggregateRating", "review", "brand", "gtin", "shippingDetails"]) expect(await codes(at(ld({ "@type": "Product", name: "x", [field]: {} }, { "@type": "BreadcrumbList" }))), field).toContain("product_data_unverifiable_field");
  });

  it("finds pages nobody links to (and sample content that is indexable)", async () => {
    const orphan = await codes(healthySite({ "/": page({ url: `${O}/`, title: "جریان ما | هنر دست‌ساز" }), [`/category/${enc("دسته")}`]: page({ url: C, title: "دستهٔ آثار بافته" }) }));
    expect(orphan).toContain("orphan_page");
    expect(await codes(healthySite({ [`/products/${enc("اثر-یک")}`]: page({ url: P, title: "محصول نمونه برای دیدن", extra: productLd }) }))).toContain("sample_content_indexable");
  });

  it("a closed site must have a closed robots.txt and an empty sitemap", async () => {
    expect(await codes(fakeSite({ "/robots.txt": "User-Agent: *\nDisallow: /", "/sitemap.xml": sitemap(), "/": page({ url: `${O}/`, robots: "noindex" }) }), false)).toEqual([]);
    expect(await codes(healthySite(), false)).toEqual(expect.arrayContaining(["robots_blocks_site", "sitemap_foreign"]));
  });

  it("marks every issue with a severity and how it gets fixed; critical first", async () => {
    const r = await audit(healthySite({ [`/products/${enc("اثر-یک")}`]: page({ url: P, title: "", robots: "noindex", extra: productLd }) }));
    expect(r.issues[0]!.severity).toBe("critical");
    expect(r.issues.every((i) => ["rebuild", "proposal", "manual"].includes(i.fix))).toBe(true);
    expect(r.issues.find((i) => i.code === "title_missing")!.fix).toBe("rebuild");
  });

  it("parses JSON-LD safely", () => {
    expect(jsonLdOf(`<script type="application/ld+json">[{"@type":"A"},{"@type":"B"}]</script><script type="application/ld+json">nope</script>`)).toEqual({ blocks: [{ "@type": "A" }, { "@type": "B" }], invalid: 1 });
  });
});

describe("page sources", () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), "seo-out-"))));
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("reads a build directory like a server (index, .html, decoded Persian paths) and never leaves it", async () => {
    await mkdir(join(dir, "products"), { recursive: true });
    await writeFile(join(dir, "index.html"), "home");
    await writeFile(join(dir, "products", "اثر.html"), "product");
    const f = directoryFetcher(dir, O);
    expect((await f.fetch(`${O}/`)).body).toBe("home");
    expect((await f.fetch(`${O}/products/${enc("اثر")}`)).body).toBe("product");
    expect((await f.fetch(`${O}/products/none`)).status).toBe(404);
    expect((await f.fetch(`${O}/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
    expect((await f.fetch("https://other.example/")).status).toBe(0);
  });

  it("the HTTP fetcher reports an unreachable page as status 0 and limits concurrency", async () => {
    let active = 0;
    let peak = 0;
    const fake = (async (url: string | URL | Request) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      if (String(url).includes("down")) throw new Error("ECONNREFUSED");
      return new Response("ok", { status: 200 });
    }) as typeof fetch;
    const f = httpFetcher(fake);
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => f.fetch(`${O}/p${i}`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(peak).toBeLessThanOrEqual(4);
    expect((await f.fetch(`${O}/down`)).status).toBe(0);
  });
});

// ---------------- proposals ----------------
const LIVE = { origin: O, indexing: true };
const NOW = "2026-11-10";
const low = (slug: string): LowCtrPage => ({ page: `${O}/products/${enc(slug)}`, metrics: { clicks: 2, impressions: 900, ctr: 0.0022, position: 5 }, expectedCtr: 0.05, missedClicks: 43 });
const setup = (products = [product({ slug: "ماکرومه-قوسی", name: "ماکرومه قوسی", category: { slug: "c", name: "ماکرومه" }, priceToman: 1_200_000, description: "" })]) => {
  const cat = catalog(products);
  return { cat, seo: buildCatalogSeo(cat, LIVE, "جریان ما", parseOverrides('{"version":1,"products":{}}')) };
};
const run = (over: Partial<Parameters<typeof propose>[0]> = {}) => {
  const { cat, seo } = setup();
  return propose({ lowCtr: [low("ماکرومه-قوسی")], catalog: cat, seo, siteName: "جریان ما", ledger: [], window: { start: "2026-10-14", end: "2026-11-10" }, today: NOW, ...over });
};

describe("improvement proposals", () => {
  it("are built only from catalogue facts and differ from what is live", () => {
    const [p] = run();
    expect(p).toBeDefined();
    expect(p!.proposed.title).toBeTruthy();
    expect(p!.proposed.title).not.toBe(p!.current.title);
    const text = `${p!.proposed.title} ${p!.proposed.description}`;
    // every word comes from the product's data or the store name or a fixed template word
    for (const w of ["ماکرومه", "قوسی", "جریان ما"]) expect(text).toContain(w.split(" ")[0]);
    expect(text).toMatch(/۱٬۲۰۰٬۰۰۰ تومان|موجود/);
    expect(p!.baseline).toMatchObject({ start: "2026-10-14", end: "2026-11-10", impressions: 900 });
  });

  it("never contains markup, superlatives, guarantees or stuffing, and fits the limits", () => {
    for (const bad of ["<b>x</b> عنوان خوب است", "بهترین ماکرومه ایران", "ارزان‌ترین قیمت", "تضمین کیفیت اثر", "اثر ۱۰۰٪ اصل", "ا".repeat(90)]) expect(rejectReason("title", bad, new Set()), bad).not.toBeNull();
    expect(rejectReason("title", "ماکرومه ماکرومه ماکرومه ماکرومه خرید", new Set())).toBe("stuffing");
    expect(rejectReason("title", "اثر دست‌ساز اصلی و زیبا", new Set())).toBeNull(); // "اصلی" is an ordinary word
    expect(rejectReason("title", "عنوان تکراری و معمولی", new Set(["عنوان تکراری و معمولی"]))).toBe("duplicate");
    for (const p of run()) {
      expect(p.proposed.title!.length).toBeLessThanOrEqual(70);
      expect(p.proposed.description!.length).toBeLessThanOrEqual(160);
    }
  });

  it("skips what must not be touched: sold-out, sample, editor-written text, non-product pages, unknown pages", () => {
    const sold = setup([product({ slug: "a", availability: "sold_out" })]);
    expect(propose({ lowCtr: [low("a")], catalog: sold.cat, seo: sold.seo, siteName: "x", ledger: [], window: { start: NOW, end: NOW }, today: NOW })).toEqual([]);
    const demo = { cat: catalog([product({ slug: "d", isDemo: true })], "demo"), seo: buildCatalogSeo(catalog([product({ slug: "d", isDemo: true })], "demo"), LIVE, "x") };
    expect(propose({ lowCtr: [low("d")], catalog: demo.cat, seo: demo.seo, siteName: "x", ledger: [], window: { start: NOW, end: NOW }, today: NOW })).toEqual([]);
    const edited = setup([product({ slug: "e", seoTitle: "عنوان ویراستار برای این صفحه", seoDescription: "توضیح ویراستار برای این صفحه که کامل است و کوتاه نیست." })]);
    expect(propose({ lowCtr: [low("e")], catalog: edited.cat, seo: edited.seo, siteName: "x", ledger: [], window: { start: NOW, end: NOW }, today: NOW })).toEqual([]);
    expect(run({ lowCtr: [{ ...low("x"), page: `${O}/category/c` }] })).toEqual([]);
    expect(run({ lowCtr: [low("not-in-catalogue")] })).toEqual([]);
  });

  it("caps the number per run, waits out the cool-down, and never repeats a text it already tried", () => {
    const many = setup(Array.from({ length: 6 }, (_, i) => product({ slug: `p${i}`, name: `اثر شمارهٔ ${i + 1}`, category: { slug: "c", name: "دسته" } })));
    const all = Array.from({ length: 6 }, (_, i) => low(`p${i}`));
    expect(propose({ lowCtr: all, catalog: many.cat, seo: many.seo, siteName: "x", ledger: [], window: { start: NOW, end: NOW }, today: NOW })).toHaveLength(3);
    const [first] = run();
    const entry: LedgerEntry = { version: 1, id: first!.id, slug: first!.slug, page: first!.page, createdAt: "2026-11-01", change: first!.proposed, previous: first!.current, baseline: first!.baseline };
    expect(run({ ledger: [entry] })).toEqual([]); // cool-down
    const later = run({ ledger: [{ ...entry, createdAt: "2026-08-01" }] })[0];
    expect(later).toBeDefined();
    expect(later!.proposed.title).not.toBe(first!.proposed.title); // a different variant, not the same text again
    expect(COOLDOWN_DAYS).toBeGreaterThanOrEqual(28);
  });

  it("are deterministic: the same input gives the same ids and texts", () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe("proposal files (the pull request's content)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "seo-repo-"));
    await mkdir(join(dir, "seo"), { recursive: true });
    await writeFile(join(dir, "seo", "overrides.json"), '{\n  "version": 1,\n  "products": {}\n}\n');
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("update overrides.json (valid for the site's loader), write one ledger entry each and a readable summary; re-running changes nothing", async () => {
    const proposals = run();
    const files = await writeProposalFiles(dir, proposals, NOW);
    expect(files).toEqual(expect.arrayContaining(["seo/overrides.json", `seo/proposals/${NOW}.md`]));
    const overrides = parseOverrides(await readFile(join(dir, "seo", "overrides.json"), "utf8")); // the build's own parser accepts it
    expect(Object.keys(overrides.products)).toEqual(["ماکرومه-قوسی"]);
    const ledger = await readLedger(dir);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ slug: "ماکرومه-قوسی", createdAt: NOW, baseline: { impressions: 900 } });
    expect(await readFile(join(dir, "seo", "proposals", `${NOW}.md`), "utf8")).toContain("عنوان پیشنهادی");
    const snapshot = [await readFile(join(dir, "seo", "overrides.json"), "utf8"), ...(await Promise.all(files.map((f) => readFile(join(dir, f), "utf8"))))].join("\n");
    await writeProposalFiles(dir, proposals, NOW);
    expect([await readFile(join(dir, "seo", "overrides.json"), "utf8"), ...(await Promise.all(files.map((f) => readFile(join(dir, f), "utf8"))))].join("\n")).toBe(snapshot);
    expect(await readLedger(dir)).toHaveLength(1); // not duplicated
  });

  it("keeps existing approved overrides and writes nothing for an empty proposal list", async () => {
    await writeFile(join(dir, "seo", "overrides.json"), JSON.stringify({ version: 1, products: { قدیمی: { title: "عنوان تأییدشدهٔ قدیمی" } } }));
    expect(await writeProposalFiles(dir, [], NOW)).toEqual([]);
    await writeProposalFiles(dir, run(), NOW);
    expect(Object.keys(parseOverrides(await readFile(join(dir, "seo", "overrides.json"), "utf8")).products).sort()).toEqual(["قدیمی", "ماکرومه-قوسی"].sort());
  });
});

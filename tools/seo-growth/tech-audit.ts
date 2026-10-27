import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import type { AuditResult, FixKind, Issue, Severity } from "./types";

/**
 * The technical SEO audit: reads a site the way a crawler does (robots.txt, sitemap.xml, every sitemap URL) from either a LIVE address
 * (workflow, independent of the storefront runtime: it only does GET requests) or a BUILD directory (`out/`). Pure checks over fetched text.
 * No headless browser is needed: the site is pre-rendered HTML, which is exactly what search engines index.
 */
export interface FetchedPage {
  status: number;
  /** Lower-case header names. */
  headers: Record<string, string>;
  body: string;
  /** The URL actually served (after redirects). */
  finalUrl: string;
}

export interface PageFetcher {
  fetch(url: string): Promise<FetchedPage>;
}

const TIMEOUT_MS = 20_000;

/** GET only, redirects followed (and reported), a short timeout, and a polite limit of 4 requests in flight. */
export function httpFetcher(fetchImpl: typeof fetch = fetch, userAgent = "JaryanMaSeoAudit/1.0 (+own site audit)"): PageFetcher {
  let active = 0;
  const waiting: Array<() => void> = [];
  const slot = async () => {
    while (active >= 4) await new Promise<void>((r) => waiting.push(r));
    active++;
  };
  return {
    async fetch(url) {
      await slot();
      try {
        const response = await fetchImpl(url, { redirect: "follow", headers: { "user-agent": userAgent, accept: "text/html,application/xml,text/plain,*/*" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const headers: Record<string, string> = {};
        response.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
        return { status: response.status, headers, body: await response.text(), finalUrl: response.url || url };
      } catch {
        return { status: 0, headers: {}, body: "", finalUrl: url };
      } finally {
        active--;
        waiting.shift()?.();
      }
    },
  };
}

/** Serves a built `out/` directory as if it were the site at `origin` (no server needed). */
export function directoryFetcher(dir: string, origin: string): PageFetcher {
  const root = normalize(dir);
  return {
    async fetch(url) {
      const u = new URL(url);
      if (u.origin !== origin) return { status: 0, headers: {}, body: "", finalUrl: url };
      let path: string;
      try {
        path = decodeURIComponent(u.pathname);
      } catch {
        return { status: 400, headers: {}, body: "", finalUrl: url };
      }
      const candidates = path === "/" ? ["index.html"] : [path.slice(1), `${path.slice(1)}.html`, join(path.slice(1), "index.html")];
      for (const c of candidates) {
        const file = normalize(join(root, c));
        if (!file.startsWith(root)) continue;
        const body = await readFile(file, "utf8").catch(() => null);
        if (body !== null) return { status: 200, headers: {}, body, finalUrl: url };
      }
      return { status: 404, headers: {}, body: "", finalUrl: url };
    },
  };
}

// ---- small HTML helpers (the same approach as scripts/seo/verify-build.mjs: the HTML is generated, not arbitrary)
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const meta = (html: string, name: string) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1];
const metaProp = (html: string, prop: string) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1];
const canonicalOf = (html: string) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
const titleOf = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1];
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export interface ParsedLd {
  blocks: Array<Record<string, unknown>>;
  invalid: number;
}
export function jsonLdOf(html: string): ParsedLd {
  const blocks: Array<Record<string, unknown>> = [];
  let invalid = 0;
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const v = JSON.parse(m[1] as string) as unknown;
      for (const item of Array.isArray(v) ? v : [v]) if (item && typeof item === "object") blocks.push(item as Record<string, unknown>);
    } catch {
      invalid++;
    }
  }
  return { blocks, invalid };
}

export const TITLE_RANGE = { min: 10, max: 70 };
export const DESCRIPTION_RANGE = { min: 50, max: 160 };
const MIN_TEXT = 150;

const FIX: Record<string, FixKind> = {
  page_unreachable: "manual",
  page_not_found: "manual",
  page_server_error: "manual",
  page_redirects: "manual",
  noindex_in_sitemap: "manual",
  robots_blocks_site: "manual",
  robots_missing: "manual",
  robots_no_sitemap: "rebuild",
  robots_private_open: "rebuild",
  sitemap_missing: "rebuild",
  sitemap_empty: "manual",
  sitemap_duplicate: "rebuild",
  sitemap_foreign: "rebuild",
  canonical_missing: "rebuild",
  canonical_mismatch: "rebuild",
  title_missing: "rebuild",
  title_length: "rebuild",
  description_missing: "rebuild",
  description_length: "rebuild",
  duplicate_title: "rebuild",
  duplicate_description: "rebuild",
  h1_count: "rebuild",
  image_alt_missing: "rebuild",
  structured_data_invalid: "rebuild",
  product_data_missing: "rebuild",
  breadcrumb_missing: "rebuild",
  product_data_unverifiable_field: "rebuild",
  lang_missing: "rebuild",
  viewport_missing: "rebuild",
  open_graph_missing: "rebuild",
  thin_content: "proposal",
  orphan_page: "rebuild",
  sample_content_indexable: "manual",
  x_robots_noindex: "manual",
};

export interface AuditOptions {
  origin: string;
  fetcher: PageFetcher;
  date: string;
  /** True once the site is launched: robots must allow crawling and the sitemap must list pages. False = closed (nothing may be indexable). */
  expectIndexing: boolean;
  /** At most this many sitemap URLs are fetched (default 500). */
  maxPages?: number;
}

const PRIVATE = ["/cart", "/checkout", "/order", "/orders", "/product?", "/api/"];

export async function auditSite(options: AuditOptions): Promise<AuditResult> {
  const { origin, fetcher, date, expectIndexing, maxPages = 500 } = options;
  const issues: Issue[] = [];
  const add = (code: string, severity: Severity, url: string, message: string) => void issues.push({ code, severity, url, message, fix: FIX[code] ?? "manual" });

  // ---- robots.txt
  const robots = await fetcher.fetch(`${origin}/robots.txt`);
  const robotsLines = robots.body.split("\n").map((l) => l.trim());
  if (robots.status !== 200) add("robots_missing", "critical", `${origin}/robots.txt`, "robots.txt در دسترس نیست.");
  else if (expectIndexing) {
    if (robotsLines.includes("Disallow: /")) add("robots_blocks_site", "critical", `${origin}/robots.txt`, "robots.txt کل سایت را برای خزنده‌ها بسته است.");
    if (!robotsLines.some((l) => l === `Sitemap: ${origin}/sitemap.xml`)) add("robots_no_sitemap", "warning", `${origin}/robots.txt`, "نشانی نقشهٔ سایت در robots.txt نیست.");
    for (const p of PRIVATE) if (!robotsLines.includes(`Disallow: ${p}`)) add("robots_private_open", "warning", `${origin}/robots.txt`, `مسیر خصوصی ${p} در robots.txt بسته نشده است.`);
  } else if (!robotsLines.includes("Disallow: /")) add("robots_blocks_site", "critical", `${origin}/robots.txt`, "سایت هنوز باز نشده اما robots.txt اجازهٔ خزیدن می‌دهد.");

  // ---- sitemap.xml
  const sitemap = await fetcher.fetch(`${origin}/sitemap.xml`);
  let urls: string[] = [];
  if (sitemap.status !== 200) add("sitemap_missing", expectIndexing ? "critical" : "info", `${origin}/sitemap.xml`, "sitemap.xml در دسترس نیست.");
  else {
    urls = [...sitemap.body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1] as string));
    if (new Set(urls).size !== urls.length) add("sitemap_duplicate", "warning", `${origin}/sitemap.xml`, "نقشهٔ سایت نشانی تکراری دارد.");
    if (urls.some((u) => !u.startsWith(`${origin}/`))) add("sitemap_foreign", "critical", `${origin}/sitemap.xml`, "نقشهٔ سایت نشانی خارج از دامنهٔ سایت دارد.");
    if (expectIndexing && urls.length === 0) add("sitemap_empty", "critical", `${origin}/sitemap.xml`, "نقشهٔ سایت خالی است.");
    if (!expectIndexing && urls.length > 0) add("sitemap_foreign", "critical", `${origin}/sitemap.xml`, "سایت بسته است اما نقشهٔ سایت نشانی دارد.");
  }
  urls = [...new Set(urls)].filter((u) => u.startsWith(`${origin}/`));
  const toCheck = urls.slice(0, maxPages);

  // ---- every page
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  const linked = new Set<string>();
  const pages = await Promise.all(toCheck.map(async (url) => [url, await fetcher.fetch(url)] as const));
  const home = await fetcher.fetch(`${origin}/`);
  for (const [, html] of [["home", home.body]] as const) for (const m of html.matchAll(/<a [^>]*href="([^"]+)"/g)) linked.add(new URL(decode(m[1] as string), `${origin}/`).href);
  for (const [url, page] of pages) for (const m of page.body.matchAll(/<a [^>]*href="([^"]+)"/g)) linked.add(new URL(decode(m[1] as string), url).href);

  for (const [url, page] of pages) {
    if (page.status === 0) {
      add("page_unreachable", "critical", url, "صفحه پاسخ نداد.");
      continue;
    }
    if (page.status === 404 || page.status === 410) {
      add("page_not_found", "critical", url, "نشانی داخل نقشهٔ سایت است اما صفحه پیدا نمی‌شود (۴۰۴).");
      continue;
    }
    if (page.status >= 500) {
      add("page_server_error", "critical", url, `خطای سرور (${page.status}).`);
      continue;
    }
    if (page.status !== 200) {
      add("page_not_found", "warning", url, `پاسخ غیرمنتظره (${page.status}).`);
      continue;
    }
    if (decodeURI(page.finalUrl) !== decodeURI(url)) add("page_redirects", "warning", url, `نشانی نقشهٔ سایت به ${page.finalUrl} منتقل می‌شود؛ نشانی نهایی را در نقشه بگذارید.`);
    const html = page.body;
    const robotsMeta = meta(html, "robots") ?? "";
    if (/noindex/i.test(robotsMeta)) add("noindex_in_sitemap", "critical", url, "صفحه در نقشهٔ سایت است اما noindex دارد.");
    if (/noindex/i.test(page.headers["x-robots-tag"] ?? "")) add("x_robots_noindex", "critical", url, "هدر X-Robots-Tag صفحه را noindex کرده است.");
    if (!/<html lang="fa"/.test(html)) add("lang_missing", "warning", url, "صفحه lang=fa ندارد.");
    if (!/<meta name="viewport"/.test(html)) add("viewport_missing", "warning", url, "متای viewport برای موبایل نیست.");

    const t = titleOf(html);
    const d = meta(html, "description");
    if (!t) add("title_missing", "critical", url, "عنوان (title) ندارد.");
    else {
      titles.set(t, [...(titles.get(t) ?? []), url]);
      if (t.length < TITLE_RANGE.min || t.length > TITLE_RANGE.max) add("title_length", "warning", url, `طول عنوان ${t.length} نویسه است (مناسب: ${TITLE_RANGE.min}–${TITLE_RANGE.max}).`);
    }
    if (!d) add("description_missing", "warning", url, "توضیح متا ندارد.");
    else {
      descriptions.set(d, [...(descriptions.get(d) ?? []), url]);
      if (d.length < DESCRIPTION_RANGE.min || d.length > DESCRIPTION_RANGE.max) add("description_length", "info", url, `طول توضیح متا ${d.length} نویسه است (مناسب: ${DESCRIPTION_RANGE.min}–${DESCRIPTION_RANGE.max}).`);
    }
    const canonical = canonicalOf(html);
    if (!canonical) add("canonical_missing", "warning", url, "آدرس canonical ندارد.");
    else if (decodeURI(decode(canonical)) !== decodeURI(url)) add("canonical_mismatch", "critical", url, `canonical به ${canonical} اشاره می‌کند، نه به خود صفحه.`);
    if (!metaProp(html, "og:title")) add("open_graph_missing", "info", url, "برچسب Open Graph (og:title) ندارد.");
    if ((html.match(/<h1[ >]/g) ?? []).length !== 1) add("h1_count", "warning", url, "صفحه باید دقیقاً یک h1 داشته باشد.");
    for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="[^"]+"/.test(m[0])) add("image_alt_missing", "warning", url, "تصویر بدون متن جایگزین (alt).");
    if (text(html).length < MIN_TEXT) add("thin_content", "info", url, "متن صفحه بسیار کم است.");

    const ld = jsonLdOf(html);
    if (ld.invalid > 0) add("structured_data_invalid", "critical", url, "داده ساخت‌یافتهٔ نامعتبر (JSON خراب) دارد.");
    const path = new URL(url).pathname;
    if (path.startsWith("/products/")) {
      const product = ld.blocks.find((b) => b["@type"] === "Product");
      if (!product) add("product_data_missing", "warning", url, "داده ساخت‌یافتهٔ Product ندارد.");
      else for (const bad of ["aggregateRating", "review", "brand", "gtin", "shippingDetails"]) if (bad in product) add("product_data_unverifiable_field", "critical", url, `Product فیلد غیرقابل‌اثبات «${bad}» دارد.`);
      if (!ld.blocks.some((b) => b["@type"] === "BreadcrumbList")) add("breadcrumb_missing", "info", url, "BreadcrumbList ندارد.");
    }
    if (/نمونه/.test(titleOf(html) ?? "") && !/noindex/i.test(robotsMeta)) add("sample_content_indexable", "critical", url, "محتوای نمونه نباید قابل ایندکس باشد.");
  }

  for (const [label, map] of [["title", titles], ["description", descriptions]] as const)
    for (const [value, list] of map) if (list.length > 1) add(`duplicate_${label}`, "warning", list[0] as string, `«${value.slice(0, 60)}» در ${list.length} صفحه تکرار شده است.`);
  // A page nobody links to is hard to discover (the sitemap alone is a weak signal).
  if (expectIndexing) for (const url of toCheck) if (!linked.has(url) && new URL(url).pathname !== "/") add("orphan_page", "info", url, "هیچ صفحه‌ای به این صفحه پیوند نداده است (فقط در نقشهٔ سایت است).");

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code) || a.url.localeCompare(b.url));
  return { date, origin, pagesChecked: toCheck.length, issues };
}

export const countBySeverity = (issues: Issue[]): Record<Severity, number> => ({
  critical: issues.filter((i) => i.severity === "critical").length,
  warning: issues.filter((i) => i.severity === "warning").length,
  info: issues.filter((i) => i.severity === "info").length,
});

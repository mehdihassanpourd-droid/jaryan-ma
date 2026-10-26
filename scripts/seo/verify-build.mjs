// Audits the exported static site (out/) the way a search engine would read it. Exits 1 on any problem.
//
//   node scripts/seo/verify-build.mjs <out-dir> <origin> [--indexing]
//
// With --indexing the site is expected to be launched (robots allow, real products indexable); without it the
// site must be fully closed (robots, noindex everywhere, empty sitemap). Sample ("demo") pages must never be indexable in either mode.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const [outDir, origin, ...flags] = process.argv.slice(2);
if (!outDir || !origin) {
  console.error("usage: verify-build.mjs <out-dir> <origin> [--indexing]");
  process.exit(64);
}
const indexing = flags.includes("--indexing");
const problems = [];
const fail = (msg) => problems.push(msg);
const read = (file) => readFileSync(join(outDir, file), "utf8");

const meta = (html, name) => html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`))?.[1];
const metaProp = (html, prop) => html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`))?.[1];
const canonical = (html) => html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
const title = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1];
const jsonLd = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#x27;/g, "'");

// ---- robots.txt and sitemap.xml
const robots = read("robots.txt");
if (indexing) {
  if (!/Allow: \//.test(robots) || /Disallow: \/\s*$/m.test(robots)) fail("robots.txt must allow crawling after launch");
  if (!robots.includes(`Sitemap: ${origin}/sitemap.xml`)) fail("robots.txt must reference the sitemap");
} else if (!/Disallow: \/\s*$/m.test(robots)) fail("robots.txt must stay closed before launch");

const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => decode(m[1]));
if (new Set(locs).size !== locs.length) fail("sitemap has duplicate URLs");
if (locs.some((u) => !u.startsWith(`${origin}/`))) fail("sitemap has URLs outside the site origin");
if (/<lastmod>|<priority>|<changefreq>/.test(sitemap)) fail("sitemap must not contain invented dates or priorities");
if (locs.some((u) => /\/demo-/.test(u))) fail("sitemap lists sample content");
if (!indexing && locs.length > 0) fail("a closed site must have an empty sitemap (robots.txt disallows everything)");

// ---- pages
const pages = [];
for (const kind of ["products", "category"]) {
  const dir = join(outDir, kind);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) if (f.endsWith(".html") && statSync(join(dir, f)).isFile()) pages.push({ kind, slug: f.slice(0, -5), file: `${kind}/${f}` });
}
const real = pages.filter((p) => p.kind === "products" && !p.slug.startsWith("demo-"));
const titles = new Map();
const descriptions = new Map();

for (const page of pages) {
  const html = read(page.file);
  const where = page.file;
  const isDemo = page.slug.startsWith("demo-");
  const url = `${origin}/${page.kind}/${encodeURIComponent(page.slug)}`;
  const robotsMeta = meta(html, "robots") ?? "";

  if (!/<html lang="fa" dir="rtl"/.test(html)) fail(`${where}: not lang=fa dir=rtl`);
  const t = title(html);
  const d = meta(html, "description");
  if (!t) fail(`${where}: missing <title>`);
  if (!d) fail(`${where}: missing meta description`);
  if (d && d.length > 200) fail(`${where}: description too long (${d.length})`);
  if (t) titles.set(t, [...(titles.get(t) ?? []), where]);
  if (d) descriptions.set(d, [...(descriptions.get(d) ?? []), where]);
  if ((html.match(/<h1[ >]/g) ?? []).length !== 1) fail(`${where}: needs exactly one <h1>`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) if (!/\balt="[^"]+"/.test(m[0])) fail(`${where}: <img> without alt text`);

  if (isDemo || !indexing) {
    if (!/noindex/.test(robotsMeta)) fail(`${where}: must be noindex`);
    if (jsonLd(html).some((j) => j["@type"] === "Product")) fail(`${where}: sample/unlaunched page must not carry Product data`);
    if (locs.includes(url)) fail(`${where}: must not be in the sitemap`);
    continue;
  }

  // real, launched page
  if (/noindex/.test(robotsMeta)) fail(`${where}: real page must be indexable`);
  if (canonical(html) !== url) fail(`${where}: canonical ${canonical(html)} != ${url}`);
  if (!locs.includes(url)) fail(`${where}: missing from the sitemap`);
  if (metaProp(html, "og:url") !== url) fail(`${where}: og:url mismatch`);
  const blocks = jsonLd(html);
  if (page.kind === "products") {
    const product = blocks.find((j) => j["@type"] === "Product");
    const crumbs = blocks.find((j) => j["@type"] === "BreadcrumbList");
    if (!product) fail(`${where}: missing Product JSON-LD`);
    else {
      if (product.url !== url) fail(`${where}: Product.url mismatch`);
      if (!product.name) fail(`${where}: Product.name missing`);
      for (const bad of ["aggregateRating", "review", "brand", "gtin", "shippingDetails"]) if (bad in product) fail(`${where}: Product has unverifiable ${bad}`);
      const offer = product.offers;
      if (offer) {
        if (offer.priceCurrency !== "IRR" || !/^\d+$/.test(String(offer.price ?? offer.lowPrice))) fail(`${where}: offer must be an IRR integer string`);
      }
    }
    if (!crumbs || crumbs.itemListElement.at(-1)?.item !== url) fail(`${where}: BreadcrumbList must end at the product`);
    else if (crumbs.itemListElement.some((c, i) => c.position !== i + 1 || !c.item.startsWith(origin))) fail(`${where}: BreadcrumbList positions/URLs invalid`);
  }
}

for (const [label, map] of [["title", titles], ["description", descriptions]]) {
  for (const [text, files] of map) if (files.length > 1) fail(`duplicate ${label} "${text}" on ${files.join(", ")}`);
}
if (indexing && real.length === 0) fail("no real product pages were generated");

// ---- home page
const home = read("index.html");
if (indexing) {
  // Next serialises the root canonical without the trailing slash; both spell the same URL.
  if (![origin, `${origin}/`].includes(canonical(home))) fail("home: canonical must be the site root");
  const types = jsonLd(home).map((j) => j["@type"]);
  if (!types.includes("Organization") || !types.includes("WebSite")) fail("home: missing Organization/WebSite data");
  if (/noindex/.test(meta(home, "robots") ?? "")) fail("home: must be indexable after launch");
  for (const j of jsonLd(home)) if ("telephone" in j || "address" in j || "email" in j) fail("home: structured data contains unconfirmed contact details");
} else if (!/noindex/.test(meta(home, "robots") ?? "")) fail("home: must be noindex before launch");

console.log(`${pages.length} pages checked (${real.length} real), ${locs.length} sitemap URLs, mode: ${indexing ? "launched" : "closed"}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("SEO verification passed.");

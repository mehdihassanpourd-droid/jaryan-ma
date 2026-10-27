import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CatalogSeo } from "../../src/seo/catalog-seo";
import { cleanText } from "../../src/seo/text";
import { OVERRIDE_DESCRIPTION_MAX, OVERRIDE_TITLE_MAX, parseOverrides, type SeoOverrides } from "../../src/seo/overrides-file";
import type { SeoCatalog, SeoProduct } from "../../src/seo/types";
import { fmtToman, pathOf } from "./format";
import type { LowCtrPage } from "./analysis";
import { addDays, type Metrics } from "./types";

/**
 * Proposed title/description improvements for pages that are shown a lot but clicked little. DETERMINISTIC and FACTUAL: every phrase is
 * assembled from the published catalogue (name, category, availability, price, lead time, the product's own description). No AI, no
 * invented claims, no keyword stuffing. A proposal is only ever a pull request; it takes effect when a person merges it (seo/overrides.json).
 */
export const MAX_PROPOSALS_PER_RUN = 3;
/** The same product is not proposed again for this many days (let the previous change show its effect). */
export const COOLDOWN_DAYS = 56;
const BANNED = /بهترین|ارزان‌?ترین|ارزان ترین|تضمین|۱۰۰\s*٪|100\s*%|(?<![\p{L}])اصل(?![\p{L}])|حراج|تخفیف|فقط امروز|رایگان|مجانی/u;

export interface ProposalText {
  title?: string;
  description?: string;
}

export interface Proposal {
  id: string;
  slug: string;
  page: string;
  metrics: Metrics & { expectedCtr: number; missedClicks: number };
  current: { title: string; description: string };
  proposed: ProposalText;
  baseline: Metrics & { start: string; end: string };
}

export interface LedgerEntry {
  version: 1;
  id: string;
  slug: string;
  page: string;
  /** The day the proposal was made. Approval (the merge) is read from git, not from this file. */
  createdAt: string;
  change: ProposalText;
  previous: { title: string; description: string };
  baseline: Metrics & { start: string; end: string };
}

const availabilityShort = (p: SeoProduct): string => (p.availability === "made_to_order" ? "ساخت پس از سفارش" : "موجود");
const priceOf = (p: SeoProduct): number | null => {
  const prices = [p.priceToman, ...p.variants.map((v) => v.priceToman)].filter((x): x is number => x !== null && x > 0);
  return prices.length > 0 ? Math.min(...prices) : null;
};

function titleCandidates(p: SeoProduct): string[] {
  const name = cleanText(p.name);
  const category = p.category ? cleanText(p.category.name) : "";
  const price = priceOf(p);
  const kind = p.fulfillment === "unique" ? "اثر یگانه" : p.fulfillment === "made_to_order" ? "ساخت پس از سفارش" : "";
  return [
    category && !name.includes(category) ? `${name} – ${category}` : "",
    price !== null ? `${name} | ${availabilityShort(p)} | ${fmtToman(price)}` : `${name} | ${availabilityShort(p)}`,
    category && kind ? `${name}؛ ${category} (${kind})` : "",
  ].filter(Boolean);
}

function descriptionCandidates(p: SeoProduct, siteName: string): string[] {
  const name = cleanText(p.name);
  const category = p.category ? cleanText(p.category.name) : "";
  const price = priceOf(p);
  const own = cleanText(p.description);
  const firstSentence = own.split(/(?<=[.!؟?])\s/u)[0] ?? "";
  const facts = [`${name}${category ? ` از دسته ${category}` : ""} در ${siteName}`, availabilityShort(p), price !== null ? `قیمت ${fmtToman(price)}` : ""].filter(Boolean).join("؛ ");
  return [
    firstSentence.length >= 25 ? `${firstSentence} ${facts}.` : "",
    `${facts}. تصاویر و جزئیات را در صفحه ببینید و دربارهٔ سفارش از اینستاگرام بپرسید.`,
    own.length >= 40 ? `${own} ${facts}.` : "",
  ].filter(Boolean);
}

/** Why a text is not acceptable (null = fine). Applied to every generated candidate and, in tests, to hostile input. */
export function rejectReason(kind: "title" | "description", value: string, taken: Set<string>): string | null {
  const max = kind === "title" ? OVERRIDE_TITLE_MAX : OVERRIDE_DESCRIPTION_MAX;
  const min = kind === "title" ? 10 : 50;
  if (value.length < min || value.length > max) return "length";
  if (/[<>]/.test(value)) return "markup";
  if (BANNED.test(value)) return "claim";
  if (taken.has(value)) return "duplicate";
  const words = value.split(/[\s،؛:|–—.()]+/u).filter((w) => w.length > 2);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  if ([...counts.values()].some((c) => c > 3)) return "stuffing";
  return null;
}

export interface ProposeInput {
  lowCtr: LowCtrPage[];
  catalog: SeoCatalog;
  seo: CatalogSeo;
  siteName: string;
  ledger: LedgerEntry[];
  window: { start: string; end: string };
  today: string;
  max?: number;
}

export function propose(input: ProposeInput): Proposal[] {
  const { lowCtr, catalog, seo, siteName, ledger, window, today, max = MAX_PROPOSALS_PER_RUN } = input;
  const bySlug = new Map(catalog.products.map((p) => [p.slug, p]));
  const takenTitles = new Set([...seo.products.values()].map((s) => s.title));
  const takenDescriptions = new Set([...seo.products.values()].map((s) => s.description));
  for (const e of ledger) {
    if (e.change.title) takenTitles.add(e.change.title);
    if (e.change.description) takenDescriptions.add(e.change.description);
  }
  const out: Proposal[] = [];
  for (const page of lowCtr) {
    if (out.length >= max) break;
    const path = pathOf(page.page);
    if (!path.startsWith("/products/")) continue;
    const slug = path.slice("/products/".length);
    const product = bySlug.get(slug);
    const current = seo.products.get(slug);
    if (!product || !current || product.isDemo || !current.indexable || product.availability === "sold_out") continue;
    if (ledger.some((e) => e.slug === slug && e.createdAt > addDays(today, -COOLDOWN_DAYS))) continue;

    const title = titleCandidates(product).find((c) => c !== current.title && rejectReason("title", c, takenTitles) === null);
    const description = descriptionCandidates(product, siteName).find((c) => c !== current.description && rejectReason("description", c, takenDescriptions) === null);
    // An editor's own SEO text is never replaced; the repository entry would lose to it anyway.
    const proposed: ProposalText = { ...(title && !product.seoTitle ? { title } : {}), ...(description && !product.seoDescription ? { description } : {}) };
    if (!proposed.title && !proposed.description) continue;
    if (proposed.title) takenTitles.add(proposed.title);
    if (proposed.description) takenDescriptions.add(proposed.description);
    const id = createHash("sha1").update(`${slug}|${proposed.title ?? ""}|${proposed.description ?? ""}`).digest("hex").slice(0, 10);
    out.push({
      id,
      slug,
      page: page.page,
      metrics: { ...page.metrics, expectedCtr: page.expectedCtr, missedClicks: page.missedClicks },
      current: { title: current.title, description: current.description },
      proposed,
      baseline: { ...page.metrics, ...window },
    });
  }
  return out;
}

// ---- files (the pull request's content)
export async function readLedger(repoRoot: string): Promise<LedgerEntry[]> {
  const dir = join(repoRoot, "seo", "improvements");
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: LedgerEntry[] = [];
  for (const n of names.filter((x) => x.endsWith(".json")).sort()) out.push(JSON.parse(await readFile(join(dir, n), "utf8")) as LedgerEntry);
  return out;
}

export const ledgerFileName = (entry: Pick<LedgerEntry, "createdAt" | "id">) => `${entry.createdAt}-${entry.id}.json`;

/** Merges the proposals into `seo/overrides.json`, writes a ledger entry for each and a readable `seo/proposals/<date>.md`. Idempotent. */
export async function writeProposalFiles(repoRoot: string, proposals: Proposal[], today: string): Promise<string[]> {
  if (proposals.length === 0) return [];
  const written: string[] = [];
  const file = join(repoRoot, "seo", "overrides.json");
  const current: SeoOverrides = parseOverrides(await readFile(file, "utf8").catch(() => '{"version":1,"products":{}}'));
  const products = { ...current.products };
  for (const p of proposals) products[p.slug] = { ...(products[p.slug] ?? {}), ...p.proposed };
  const sorted = Object.fromEntries(Object.entries(products).sort(([a], [b]) => (a < b ? -1 : 1)));
  await mkdir(join(repoRoot, "seo", "improvements"), { recursive: true });
  await mkdir(join(repoRoot, "seo", "proposals"), { recursive: true });
  await writeFile(file, `${JSON.stringify({ version: 1, products: sorted }, null, 2)}\n`);
  written.push("seo/overrides.json");
  for (const p of proposals) {
    const entry: LedgerEntry = { version: 1, id: p.id, slug: p.slug, page: p.page, createdAt: today, change: p.proposed, previous: p.current, baseline: p.baseline };
    const name = `seo/improvements/${ledgerFileName(entry)}`;
    await writeFile(join(repoRoot, name), `${JSON.stringify(entry, null, 2)}\n`);
    written.push(name);
  }
  const md = proposalMarkdown(proposals, today);
  await writeFile(join(repoRoot, "seo", "proposals", `${today}.md`), md);
  written.push(`seo/proposals/${today}.md`);
  return written;
}

export function proposalMarkdown(proposals: Proposal[], today: string): string {
  const lines = [
    `# پیشنهادهای بهبود سئو – ${today}`,
    "",
    "> این پیشنهادها خودکار و فقط از اطلاعات واقعی کاتالوگ ساخته شده‌اند (نام، دسته، موجودی، قیمت، توضیح خود محصول). هیچ ادعایی اضافه نشده است.",
    "> با ادغام این درخواست، متن‌ها در `seo/overrides.json` فعال می‌شوند؛ عنوان/توضیحی که ویراستار در پنل نوشته باشد همیشه مقدم است. نتیجه ۱۴ و ۲۸ روز بعد از ادغام در گزارش‌ها اندازه‌گیری می‌شود.",
    "",
  ];
  for (const p of proposals) {
    lines.push(`## ${pathOf(p.page)}`, "", `نمایش: ${Math.round(p.metrics.impressions)} · کلیک: ${Math.round(p.metrics.clicks)} · نرخ کلیک: ${(p.metrics.ctr * 100).toFixed(1)}٪ (انتظار برای این جایگاه ≈ ${(p.metrics.expectedCtr * 100).toFixed(1)}٪) · جایگاه میانگین: ${p.metrics.position.toFixed(1)}`, "");
    if (p.proposed.title) lines.push(`- عنوان فعلی: ${p.current.title}`, `- **عنوان پیشنهادی:** ${p.proposed.title}`);
    if (p.proposed.description) lines.push(`- توضیح فعلی: ${p.current.description}`, `- **توضیح پیشنهادی:** ${p.proposed.description}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

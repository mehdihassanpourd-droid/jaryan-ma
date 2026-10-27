import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { SNAPSHOT_PATHS } from "../../src/domain/product/snapshot";
import { manifestSchema, shardSchema } from "../../src/domain/product/snapshot-schema";
import { buildCatalogSeo } from "../../src/seo/catalog-seo";
import { dirReader, httpReader, loadSnapshotCatalog, type SnapshotReader } from "../../src/seo/catalog-source";
import { loadOverrides } from "../../src/seo/overrides-file";
import { site } from "../../src/lib/site";
import { lowCtrPages } from "./analysis";
import { demoFixture } from "./fixtures";
import { GscError, clientFromEnv } from "./gsc-client";
import { isoWeek } from "./format";
import { propose, readLedger, writeProposalFiles, type LedgerEntry } from "./proposals";
import { buildReport } from "./report";
import { FileMetricsStore } from "./store";
import { auditSite, countBySeverity, directoryFetcher, httpFetcher } from "./tech-audit";
import { trackImprovement, type TrackedImprovement } from "./tracking";
import { addDays, dateRange, isoDate, type AuditResult } from "./types";

/**
 * Command line of the SEO growth tools (run by `.github/workflows/seo-monitor.yml`, or by hand):
 *
 *   fetch        Search Console -> history (needs GSC_SERVICE_ACCOUNT_JSON + GSC_SITE_URL; without them: a notice, exit 0)
 *   audit        technical audit of the live site (SITE_URL) or a build directory (--dir out --origin https://…)
 *   report       weekly / monthly Markdown report from the stored history
 *   propose      title/description proposals for high-impression, low-CTR pages (writes files in the working tree, never commits)
 *   fingerprint  hash of the published catalogue (tells the workflow the site needs a rebuild)
 *   demo         a report from SYNTHETIC fixture data (clearly labelled) to preview the output
 *
 * Nothing here runs in the storefront, the admin or the API server, and nothing is ever merged or deployed by these commands.
 */
const run = promisify(execFile);
const env = process.env;

function flags(argv: string[]) {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) out.set(a.slice(2), argv[i + 1] && !argv[i + 1]!.startsWith("--") ? (argv[++i] as string) : "true");
  }
  return out;
}

const today = () => env.SEO_TODAY ?? isoDate(new Date());
const store = () => new FileMetricsStore(resolve(env.SEO_DATA_DIR ?? ".seo-data"));
/** Search Console's newest final day is about 2-3 days old. */
const defaultEnd = () => addDays(today(), -3);

function output(name: string, value: string) {
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${value}\n`);
}
function summary(markdown: string) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

async function fetchCommand(f: Map<string, string>) {
  const client = clientFromEnv(env);
  if (!client) {
    console.log("::notice::Search Console is not configured (GSC_SERVICE_ACCOUNT_JSON / GSC_SITE_URL): nothing fetched. See docs/seo/SEARCH-CONSOLE-SETUP-FA.md");
    output("fetched", "0");
    summary("### Search Console\nنه اعتبارنامه تنظیم شده است؛ داده‌ای دریافت نشد (چیزی ساخته نمی‌شود).");
    return 0;
  }
  const end = f.get("end") ?? defaultEnd();
  const n = Number(f.get("days") ?? 5);
  // Re-fetching the last few days is intended: late data refines them, and an identical day is not rewritten.
  const dates = dateRange(addDays(end, -(n - 1)), end);
  const s = store();
  let written = 0;
  for (const date of dates) {
    const day = await client.fetchDay(date);
    if ((await s.putDay(day)) === "written") written++;
    console.log(`${date}: ${day.pages.length} pages, ${day.queries.length} page+query rows`);
  }
  output("fetched", String(dates.length));
  output("written", String(written));
  return 0;
}

async function auditCommand(f: Map<string, string>) {
  const dir = f.get("dir");
  const origin = (f.get("origin") ?? env.SITE_URL ?? "").replace(/\/+$/, "");
  if (!origin) {
    console.log("::notice::SITE_URL is not set: no technical audit.");
    output("audited", "0");
    return 0;
  }
  const expectIndexing = (f.get("expect-indexing") ?? env.SEO_ALLOW_INDEXING ?? "true") === "true";
  const result = await auditSite({ origin, fetcher: dir ? directoryFetcher(dir, origin) : httpFetcher(), date: today(), expectIndexing });
  const c = countBySeverity(result.issues);
  console.log(`${result.pagesChecked} pages, ${c.critical} critical, ${c.warning} warnings, ${c.info} info`);
  for (const i of result.issues.slice(0, 40)) console.log(`[${i.severity}] ${i.code} ${i.url} – ${i.message}`);
  if (!dir) await store().putArtifact(`audits/${result.date}.json`, `${JSON.stringify(result, null, 1)}\n`);
  output("audited", "1");
  output("critical", String(c.critical));
  summary(`### بررسی فنی\n${result.pagesChecked} صفحه – بحرانی: ${c.critical} · هشدار: ${c.warning} · اطلاع: ${c.info}`);
  const failOn = f.get("fail-on");
  return failOn === "critical" && c.critical > 0 ? 1 : 0;
}

async function latestAudit(s: FileMetricsStore, end: string): Promise<AuditResult | null> {
  for (let d = end; d > addDays(end, -40); d = addDays(d, -1)) {
    const text = await s.readArtifact(`audits/${d}.json`);
    if (text) return JSON.parse(text) as AuditResult;
  }
  return null;
}

/** The day a ledger file first appeared on the checked-out branch (= the day its pull request was merged), or null. */
async function approvalDate(repoRoot: string, entry: LedgerEntry): Promise<string | null> {
  try {
    const { stdout } = await run("git", ["log", "--diff-filter=A", "--format=%aI", "--", `seo/improvements/${entry.createdAt}-${entry.id}.json`], { cwd: repoRoot });
    const last = stdout.trim().split("\n").filter(Boolean).at(-1);
    return last ? last.slice(0, 10) : null;
  } catch {
    return null;
  }
}

async function trackedImprovements(s: FileMetricsStore, repoRoot: string, now: string): Promise<TrackedImprovement[]> {
  const out: TrackedImprovement[] = [];
  for (const entry of await readLedger(repoRoot)) out.push(await trackImprovement(entry, await approvalDate(repoRoot, entry), s, now));
  return out;
}

async function reportCommand(f: Map<string, string>) {
  const period = f.get("period") === "monthly" ? "monthly" : "weekly";
  const end = f.get("end") ?? defaultEnd();
  const s = store();
  const report = await buildReport({ period, end, store: s, audit: await latestAudit(s, end), tracked: await trackedImprovements(s, resolve(f.get("repo") ?? "."), today()) });
  await s.putArtifact(`${report.file}.md`, report.markdown);
  await s.putArtifact(`${report.file}.json`, `${JSON.stringify(report.summary, null, 1)}\n`);
  console.log(report.markdown);
  summary(report.markdown);
  output("report", report.file);
  return 0;
}

function snapshotReader(): SnapshotReader | null {
  return env.CATALOG_SNAPSHOT_DIR ? dirReader(env.CATALOG_SNAPSHOT_DIR) : env.CATALOG_SNAPSHOT_URL ? httpReader(env.CATALOG_SNAPSHOT_URL) : null;
}

async function proposeCommand(f: Map<string, string>) {
  const repoRoot = resolve(f.get("repo") ?? ".");
  const end = f.get("end") ?? defaultEnd();
  const reader = snapshotReader();
  const origin = (env.SITE_URL ?? env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  if (!reader || !origin) {
    console.log("::notice::CATALOG_SNAPSHOT_URL/DIR and SITE_URL are needed to propose changes from real catalogue data: nothing proposed.");
    output("changed", "false");
    return 0;
  }
  const days = await store().range(addDays(end, -27), end);
  if (days.length < 7 || days.some((d) => d.source !== "gsc")) {
    console.log("::notice::Less than 7 days of real Search Console data: no proposals (fixture data is never used for proposals).");
    output("changed", "false");
    return 0;
  }
  const catalog = await loadSnapshotCatalog(reader);
  const seo = buildCatalogSeo(catalog, { origin, indexing: true }, site.name, loadOverrides(repoRoot));
  const proposals = propose({ lowCtr: lowCtrPages(days), catalog, seo, siteName: site.name, ledger: await readLedger(repoRoot), window: { start: addDays(end, -27), end }, today: today() });
  const files = await writeProposalFiles(repoRoot, proposals, today());
  console.log(JSON.stringify({ proposals: proposals.map((p) => ({ id: p.id, slug: p.slug, proposed: p.proposed })) }, null, 1));
  output("changed", files.length > 0 ? "true" : "false");
  output("count", String(proposals.length));
  output("id", createHash("sha1").update(proposals.map((p) => p.id).sort().join(",")).digest("hex").slice(0, 8));
  return 0;
}

/** A hash of everything the storefront build would read from the published catalogue: it changes exactly when a rebuild would produce different pages. */
async function fingerprintCommand() {
  const reader = snapshotReader();
  if (!reader) {
    console.log("::notice::CATALOG_SNAPSHOT_URL/DIR not set: no fingerprint.");
    output("changed", "false");
    return 0;
  }
  const hash = createHash("sha256");
  const manifest = await reader.readText(SNAPSHOT_PATHS.manifest);
  if (manifest === null) throw new Error("catalog_snapshot_manifest_missing");
  hash.update(manifest);
  const parsed = manifestSchema.parse(JSON.parse(manifest));
  const slugs = new Set<string>();
  for (const c of parsed.categories.filter((x) => x.count > 0)) {
    const text = await reader.readText(SNAPSHOT_PATHS.category(c.slug));
    if (text === null) continue;
    hash.update(text);
    for (const card of shardSchema.parse(JSON.parse(text)).products) slugs.add(card.slug);
  }
  for (const slug of [...slugs].sort()) hash.update((await reader.readText(SNAPSHOT_PATHS.product(slug))) ?? "");
  const fingerprint = hash.digest("hex");
  const s = store();
  const previous = (JSON.parse((await s.readArtifact("catalog-fingerprint.json")) ?? "{}") as { fingerprint?: string }).fingerprint;
  console.log(`catalogue fingerprint ${fingerprint.slice(0, 12)} (previous ${previous?.slice(0, 12) ?? "none"})`);
  output("fingerprint", fingerprint);
  output("changed", previous !== undefined && previous !== fingerprint ? "true" : "false");
  output("first", previous === undefined ? "true" : "false");
  return 0;
}

async function recordFingerprint(f: Map<string, string>) {
  const value = f.get("value");
  if (!value || !/^[0-9a-f]{64}$/.test(value)) throw new Error("usage: record-fingerprint --value <sha256>");
  await store().putArtifact("catalog-fingerprint.json", `${JSON.stringify({ fingerprint: value })}\n`);
  return 0;
}

async function demoCommand(f: Map<string, string>) {
  const out = resolve(f.get("out") ?? ".seo-demo");
  const end = f.get("end") ?? defaultEnd();
  const origin = "https://demo.example";
  const s = new FileMetricsStore(out);
  for (const day of demoFixture(origin, end)) await s.putDay(day);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, "README.txt"), "SYNTHETIC fixture data (source: fixture). Not real Google traffic.\n");
  const report = await buildReport({ period: f.get("period") === "monthly" ? "monthly" : "weekly", end, store: s, audit: null, tracked: [] });
  await s.putArtifact(`${report.file}.md`, report.markdown);
  console.log(report.markdown);
  console.log(`(preview written to ${out}; ISO week ${isoWeek(end)})`);
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const f = flags(rest);
  switch (command) {
    case "fetch":
      return fetchCommand(f);
    case "audit":
      return auditCommand(f);
    case "report":
      return reportCommand(f);
    case "propose":
      return proposeCommand(f);
    case "fingerprint":
      return fingerprintCommand();
    case "record-fingerprint":
      return recordFingerprint(f);
    case "demo":
      return demoCommand(f);
    default:
      console.error("usage: cli.ts fetch|audit|report|propose|fingerprint|record-fingerprint|demo [options]");
      return 64;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    // Messages are short codes (no keys, no response bodies): safe for public logs.
    console.error(error instanceof GscError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);

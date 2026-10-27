import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoFixture, fixtureDays } from "./fixtures";
import type { LedgerEntry } from "./proposals";
import { buildReport } from "./report";
import { FileMetricsStore } from "./store";
import { judge, trackImprovement } from "./tracking";
import { addDays, type AuditResult, type DayData } from "./types";

const O = "https://jaryan.example.ir";
const PAGE = `${O}/products/${encodeURIComponent("اثر")}`;
let dir: string;
let store: FileMetricsStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seo-track-"));
  store = new FileMetricsStore(dir);
});
afterEach(async () => rm(dir, { recursive: true, force: true }));

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  version: 1, id: "abc123", slug: "اثر", page: PAGE, createdAt: "2026-10-01", change: { title: "عنوان تازه برای صفحه" }, previous: { title: "قدیمی", description: "توضیح قدیمی" },
  baseline: { start: "2026-09-03", end: "2026-09-30", clicks: 20, impressions: 1000, ctr: 0.02, position: 5 }, ...over,
});
async function load(days: DayData[]) {
  for (const d of days) await store.putDay(d);
}
const APPROVED = "2026-10-10";
/** 28 days before approval at CTR 2 %, then `afterCtr` after it; the rest of the site stays flat unless `siteFactor` says otherwise. */
const history = (afterCtr: number, siteFactor = 1) =>
  fixtureDays({
    start: addDays(APPROVED, -28),
    end: addDays(APPROVED, 45),
    siteUrl: `${O}/`,
    pages: [
      { url: PAGE, impressions: 100, ctr: 0.02, position: 5, queries: [], ctrBoostFrom: { date: addDays(APPROVED, 3), factor: afterCtr / 0.02 } },
      { url: `${O}/`, impressions: 400, ctr: 0.05, position: 3, queries: [], ctrBoostFrom: { date: addDays(APPROVED, 3), factor: siteFactor } },
    ],
  });

describe("tracking an approved improvement", () => {
  it("not merged yet = only a proposal: nothing is measured", async () => {
    expect(await trackImprovement(entry(), null, store, "2026-12-01")).toMatchObject({ approvedAt: null, evaluations: [] });
  });

  it("is pending until the window is complete and the data final", async () => {
    await load(history(0.02));
    const early = await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 10));
    expect(early.evaluations.map((e) => e.status)).toEqual(["pending", "pending"]);
    expect(early.evaluations[0]!.availableOn).toBe(addDays(APPROVED, 3 + 14 - 1 + 3));
    const mid = await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 25));
    expect(mid.evaluations.map((e) => e.status)).toEqual(["measured", "pending"]);
  });

  it("an edit that raised CTR is 'improved' at both horizons", async () => {
    await load(history(0.04));
    const t = await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45));
    expect(t.evaluations.map((e) => e.verdict)).toEqual(["improved", "improved"]);
    expect(t.evaluations[1]!.ctrChange!).toBeGreaterThan(0.7);
    expect(t.evaluations[1]!.before!.impressions).toBeGreaterThan(80); // a per-day rate (≈ 100/day)
    expect(t.evaluations[0]!.impressionsChange!).toBeGreaterThan(-0.2); // 14 days against 14 days, not 28 against 14
  });

  it("an edit that lowered CTR is 'worse'; no change is 'neutral'", async () => {
    await load(history(0.012));
    expect((await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45))).evaluations[1]!.verdict).toBe("worse");
    await rm(join(dir, "days"), { recursive: true });
    await load(history(0.02));
    expect((await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45))).evaluations[1]!.verdict).toBe("neutral");
  });

  it("does not credit the edit with a site-wide swing (CTR adjusted by the whole site)", async () => {
    await load(history(0.03, 1.5)); // the page +50 %, but the whole site +50 % too
    const e = (await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45))).evaluations[1]!;
    expect(e.ctrChange!).toBeGreaterThan(0.4);
    expect(Math.abs(e.adjustedCtrChange!)).toBeLessThan(0.1);
    expect(e.verdict).toBe("neutral");
  });

  it("without enough impressions, or enough days of data, it says so instead of guessing", async () => {
    expect(judge({ clicks: 0.1, impressions: 2, ctr: 0.05, position: 5 }, { clicks: 5, impressions: 40, ctr: 0.05, position: 5 }, 0.5, 19, 14)).toBe("insufficient_data");
    expect(judge({ clicks: 1, impressions: 40, ctr: 0.02, position: 5 }, { clicks: 5, impressions: 40, ctr: 0.05, position: 5 }, null, 0, 14)).toBe("insufficient_data");
    await load(history(0.04).filter((d) => d.date <= addDays(APPROVED, 8))); // the "after" window is nearly empty
    const t = await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45));
    expect(t.evaluations[1]!.verdict).toBe("insufficient_data");
  });

  it("falls back to the baseline stored in the proposal when the history before approval is not available", async () => {
    await load(history(0.04).filter((d) => d.date >= APPROVED));
    const e = (await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45))).evaluations[1]!;
    expect(e.before!.impressions).toBeCloseTo(1000 / 28); // the proposal's 28-day baseline as a per-day rate
    expect(e.before!.ctr).toBeCloseTo(0.02);
  });
});

const REPORT_END = "2026-11-08";
describe("reports", () => {
  it("with no stored data: says so, shows no numbers, and points to the setup guide", async () => {
    const r = await buildReport({ period: "weekly", end: REPORT_END, store, audit: null, tracked: [] });
    expect(r.markdown).toContain("داده‌ای از Search Console ذخیره نشده است");
    expect(r.markdown).toContain("SEARCH-CONSOLE-SETUP-FA.md");
    expect(r.markdown).not.toContain("## خلاصه");
    expect(r.summary).toMatchObject({ source: "none", dataDays: 0, clicks: 0 });
    expect(r.file).toBe("reports/weekly/2026-W45");
  });

  it("fixture data is labelled loudly (never passed off as real)", async () => {
    await load(demoFixture(O, REPORT_END));
    const r = await buildReport({ period: "weekly", end: REPORT_END, store, audit: null, tracked: [] });
    expect(r.markdown).toContain("آزمایشی (fixture)");
    expect(r.summary.source).toBe("fixture");
  });

  it("real-source data has no fixture banner, and the numbers match the stored rows", async () => {
    const days = demoFixture(O, REPORT_END).map((d) => ({ ...d, source: "gsc" as const }));
    await load(days);
    const r = await buildReport({ period: "weekly", end: REPORT_END, store, audit: null, tracked: [] });
    expect(r.markdown).not.toContain("آزمایشی (fixture)");
    const week = days.filter((d) => d.date > addDays(REPORT_END, -7));
    const clicks = week.flatMap((d) => d.pages).reduce((n, p) => n + p.clicks, 0);
    expect(r.summary.clicks).toBe(clicks);
    expect(r.summary.dataDays).toBe(7);
    expect(r.markdown).toContain("## افت ترافیک");
    expect(r.markdown).toContain("/category/دیوارکوب"); // the designed drop is reported
    expect(r.markdown).toContain("نمایش زیاد، کلیک کم");
  });

  it("reports missing days instead of hiding them, and monthly reports cover 28 days", async () => {
    await load(demoFixture(O, REPORT_END, 80).filter((d) => d.date !== "2026-11-05").map((d) => ({ ...d, source: "gsc" as const })));
    const w = await buildReport({ period: "weekly", end: REPORT_END, store, audit: null, tracked: [] });
    expect(w.summary.dataDays).toBe(6);
    expect(w.markdown).toContain("2026-11-05");
    const m = await buildReport({ period: "monthly", end: REPORT_END, store, audit: null, tracked: [] });
    expect(m.summary).toMatchObject({ start: "2026-10-12", end: "2026-11-08", expectedDays: 28 });
    expect(m.file).toBe("reports/monthly/2026-11");
  });

  it("includes the technical audit and the improvement tracking", async () => {
    const audit: AuditResult = { date: "2026-11-08", origin: O, pagesChecked: 12, issues: [{ code: "canonical_mismatch", severity: "critical", url: PAGE, message: "canonical اشتباه", fix: "rebuild" }] };
    await load(history(0.04).map((d) => ({ ...d, source: "gsc" as const })));
    const tracked = [await trackImprovement(entry(), APPROVED, store, addDays(APPROVED, 45)), await trackImprovement(entry({ id: "zzz", page: `${O}/products/b` }), null, store, "2026-11-08")];
    const r = await buildReport({ period: "weekly", end: addDays(APPROVED, 40), store, audit, tracked });
    expect(r.markdown).toContain("canonical_mismatch");
    expect(r.markdown).toContain("بحرانی: ۱");
    expect(r.markdown).toContain("بهبود");
    expect(r.markdown).toContain("هنوز ادغام نشده");
    expect(r.markdown).toContain("شاهد است، نه اثبات");
    expect(r.summary.auditCritical).toBe(1);
  });
});

// ---------------- the command line ----------------
const run = promisify(execFile);
const cli = (args: string[], env: Record<string, string> = {}) =>
  run("npx", ["tsx", "tools/seo-growth/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, GSC_SERVICE_ACCOUNT_JSON: "", GSC_SITE_URL: "", SITE_URL: "", CATALOG_SNAPSHOT_URL: "", CATALOG_SNAPSHOT_DIR: "", ...env }, timeout: 120_000 }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e: { code?: number; stdout?: string; stderr?: string }) => ({ code: e.code ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") }),
  );

describe("command line", () => {
  it("fetch without credentials is a notice and a success, and writes nothing", async () => {
    const r = await cli(["fetch"], { SEO_DATA_DIR: dir });
    expect(r.code).toBe(0);
    expect(r.out).toContain("Search Console is not configured");
    expect(await store.listDates()).toEqual([]);
  });

  it("fetch with a broken key fails with a short code and never prints the key", async () => {
    const r = await cli(["fetch"], { SEO_DATA_DIR: dir, GSC_SERVICE_ACCOUNT_JSON: '{"client_email":"a@b.co","private_key":"-----BEGIN PRIVATE KEY-----SECRETSECRET"}', GSC_SITE_URL: "sc-domain:example.ir" });
    expect(r.code).toBe(1);
    expect(r.out).not.toContain("SECRETSECRET");
  });

  it("report and demo run on stored data; the demo is labelled as fixture", async () => {
    const demo = await cli(["demo", "--out", join(dir, "demo"), "--end", REPORT_END]);
    expect(demo.code).toBe(0);
    expect(demo.out).toContain("آزمایشی (fixture)");
    expect(await readFile(join(dir, "demo", "README.txt"), "utf8")).toContain("SYNTHETIC");
    const empty = await cli(["report", "--period", "weekly", "--end", REPORT_END], { SEO_DATA_DIR: join(dir, "real") });
    expect(empty.code).toBe(0);
    expect(empty.out).toContain("داده‌ای از Search Console ذخیره نشده است");
    expect(await readFile(join(dir, "real", "reports", "weekly", "2026-W45.json"), "utf8")).toContain('"source": "none"');
  });

  it("audit without SITE_URL is a notice; propose without real data proposes nothing", async () => {
    expect((await cli(["audit"], { SEO_DATA_DIR: dir })).out).toContain("SITE_URL is not set");
    const snapshot = join(dir, "snapshot");
    await mkdir(snapshot, { recursive: true });
    const r = await cli(["propose", "--repo", dir], { SEO_DATA_DIR: dir, SITE_URL: O, CATALOG_SNAPSHOT_DIR: snapshot });
    expect(r.code).toBe(0);
    expect(r.out).toContain("no proposals");
    await expect(readFile(join(dir, "seo", "overrides.json"), "utf8")).rejects.toThrow();
  });

  it("propose refuses fixture data (only real Search Console days can drive a change)", async () => {
    await load(demoFixture(O, addDays(new Date().toISOString().slice(0, 10), -3)));
    const snapshot = join(dir, "snapshot");
    await mkdir(snapshot, { recursive: true });
    const r = await cli(["propose", "--repo", dir], { SEO_DATA_DIR: dir, SITE_URL: O, CATALOG_SNAPSHOT_DIR: snapshot });
    expect(r.out).toContain("fixture data is never used");
  });

  it("an unknown command is a usage error", async () => {
    expect((await cli(["nope"])).code).toBe(64);
  });

  void writeFile;
});

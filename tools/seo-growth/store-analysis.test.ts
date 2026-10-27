import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { byPage, change, combine, coverage, detectTrafficDrops, expectedCtr, lowCtrPages, rankingOpportunities, totals } from "./analysis";
import { fixtureDays } from "./fixtures";
import { FileMetricsStore, MAX_PAGE_ROWS } from "./store";
import type { DayData } from "./types";
import { addDays, dateRange, isoDate } from "./types";

const O = "https://example.ir";
const day = (date: string, pages: Array<[string, number, number, number?]>, queries: Array<[string, string, number, number, number]> = []): DayData => ({
  date,
  fetchedAt: "2026-11-10T00:00:00.000Z",
  source: "gsc",
  siteUrl: `${O}/`,
  pages: pages.map(([p, clicks, impressions, position = 5]) => ({ page: `${O}${p}`, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position })),
  queries: queries.map(([p, query, clicks, impressions, position]) => ({ page: `${O}${p}`, query, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position })),
});

describe("dates", () => {
  it("add, range and format without time-zone surprises", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dateRange("2026-11-01", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
    expect(isoDate(new Date("2026-11-10T23:59:59Z"))).toBe("2026-11-10");
  });
});

describe("history store", () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(join(tmpdir(), "seo-store-"))));
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it("writes a day once; the same data again changes nothing (safe to re-run)", async () => {
    const s = new FileMetricsStore(dir);
    const d = day("2026-11-01", [["/a", 5, 50]]);
    expect(await s.putDay(d)).toBe("written");
    const first = await readFile(join(dir, "days", "2026-11-01.json"), "utf8");
    expect(await s.putDay({ ...d, fetchedAt: "2026-11-11T00:00:00.000Z" })).toBe("unchanged"); // a later look at identical numbers
    expect(await readFile(join(dir, "days", "2026-11-01.json"), "utf8")).toBe(first);
    expect(await s.putDay(day("2026-11-01", [["/a", 6, 50]]))).toBe("written"); // late data refines the day
    expect((await s.getDay("2026-11-01"))!.pages[0]!.clicks).toBe(6);
    expect(await s.listDates()).toEqual(["2026-11-01"]); // never a second file or a duplicate row
  });

  it("is deterministic: row order does not change the file", async () => {
    const a = new FileMetricsStore(dir);
    const b = new FileMetricsStore(join(dir, "b"));
    await a.putDay(day("2026-11-01", [["/b", 1, 10], ["/a", 2, 20]]));
    await b.putDay(day("2026-11-01", [["/a", 2, 20], ["/b", 1, 10]]));
    expect(await readFile(join(dir, "days", "2026-11-01.json"), "utf8")).toBe(await readFile(join(dir, "b", "days", "2026-11-01.json"), "utf8"));
  });

  it("returns ranges, tolerates gaps, and bounds the stored rows (largest first)", async () => {
    const s = new FileMetricsStore(dir);
    for (const d of ["2026-11-01", "2026-11-03", "2026-11-09"]) await s.putDay(day(d, [["/a", 1, 10]]));
    expect((await s.range("2026-11-01", "2026-11-05")).map((x) => x.date)).toEqual(["2026-11-01", "2026-11-03"]);
    expect(await s.getDay("2026-11-02")).toBeNull();
    const big = day("2026-11-10", Array.from({ length: MAX_PAGE_ROWS + 50 }, (_, i) => [`/p${i}`, 0, i + 1] as [string, number, number]));
    await s.putDay(big);
    const stored = (await s.getDay("2026-11-10"))!;
    expect(stored.pages).toHaveLength(MAX_PAGE_ROWS);
    expect(stored.pages.some((p) => p.page === `${O}/p${MAX_PAGE_ROWS + 49}`)).toBe(true); // the highest-impression rows survive
    expect(stored.pages.some((p) => p.page === `${O}/p0`)).toBe(false);
  });

  it("refuses bad dates and paths outside its directory, and rejects corrupt files", async () => {
    const s = new FileMetricsStore(dir);
    await expect(s.getDay("../etc/passwd")).rejects.toThrow("invalid_date");
    await expect(s.putArtifact("../x.txt", "x")).rejects.toThrow("invalid_path");
    await expect(s.readArtifact("/etc/passwd")).rejects.toThrow("invalid_path");
    await s.putDay(day("2026-11-01", [["/a", 1, 10]]));
    await writeFile(join(dir, "days", "2026-11-01.json"), '{"date":"2026-11-01"}');
    await expect(s.getDay("2026-11-01")).rejects.toThrow();
  });

  it("artifacts are idempotent too", async () => {
    const s = new FileMetricsStore(dir);
    expect(await s.putArtifact("reports/weekly/2026-W45.md", "x")).toBe("written");
    expect(await s.putArtifact("reports/weekly/2026-W45.md", "x")).toBe("unchanged");
    expect(await s.readArtifact("reports/weekly/none.md")).toBeNull();
  });
});

describe("aggregation", () => {
  it("recomputes CTR from sums and weights positions by impressions", () => {
    const m = combine([{ clicks: 10, impressions: 100, ctr: 0.1, position: 2 }, { clicks: 0, impressions: 900, ctr: 0, position: 12 }]);
    expect(m.clicks).toBe(10);
    expect(m.ctr).toBeCloseTo(0.01);
    expect(m.position).toBeCloseTo(11); // not (2 + 12) / 2
    expect(combine([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
  });
  it("groups by page across days", () => {
    const days = [day("2026-11-01", [["/a", 1, 10, 3]]), day("2026-11-02", [["/a", 3, 30, 5]])];
    expect(byPage(days).get(`${O}/a`)).toMatchObject({ clicks: 4, impressions: 40, position: 4.5 });
    expect(totals(days)).toMatchObject({ clicks: 4, days: 2 });
  });
  it("change is null when there is nothing to compare with", () => {
    expect(change(5, 0)).toBeNull();
    expect(change(5, 10)).toBe(-0.5);
  });
});

describe("traffic drops", () => {
  const period = (start: string, rows: Array<[string, number, number]>) => dateRange(start, addDays(start, 6)).map((d) => day(d, rows.map(([p, c, i]) => [p, c, i])));

  it("flags a page that lost a large share of real traffic, and the site as a whole", () => {
    const drops = detectTrafficDrops(period("2026-11-08", [["/a", 1, 100], ["/b", 5, 100]]), period("2026-11-01", [["/a", 10, 100], ["/b", 5, 100]]));
    expect(drops.map((d) => [d.scope, d.page && new URL(d.page).pathname])).toEqual([["site", null], ["page", "/a"]]); // equal losses: the site-wide line first
    expect(drops[1]).toMatchObject({ clicksChange: -0.9, severity: "high" });
  });

  it("ignores noise: small numbers, small losses, gains", () => {
    expect(detectTrafficDrops(period("2026-11-08", [["/a", 0, 10]]), period("2026-11-01", [["/a", 1, 10]]))).toEqual([]); // 7 -> 0 clicks: below the minimum volume
    expect(detectTrafficDrops(period("2026-11-08", [["/a", 5, 100]]), period("2026-11-01", [["/a", 6, 100]]))).toEqual([]); // -17 %
    expect(detectTrafficDrops(period("2026-11-08", [["/a", 9, 100]]), period("2026-11-01", [["/a", 5, 100]]))).toEqual([]);
  });

  it("a page that disappeared entirely is a drop", () => {
    const drops = detectTrafficDrops(period("2026-11-08", [["/b", 5, 100]]), period("2026-11-01", [["/a", 10, 100], ["/b", 5, 100]]));
    expect(drops.some((d) => d.page?.endsWith("/a") && d.current.clicks === 0)).toBe(true);
  });

  it("finds the drop the fixture was designed to contain", () => {
    const days = fixtureDays({ start: "2026-10-01", end: "2026-11-14", siteUrl: `${O}/`, pages: [{ url: `${O}/x`, impressions: 500, ctr: 0.08, position: 4, queries: [], dropFrom: "2026-11-08" }] });
    const drops = detectTrafficDrops(days.filter((d) => d.date >= "2026-11-08"), days.filter((d) => d.date >= "2026-11-01" && d.date < "2026-11-08"));
    expect(drops.some((d) => d.page === `${O}/x`)).toBe(true);
  });
});

describe("high-impression, low-CTR pages", () => {
  it("uses a position-aware expectation and ranks by missed clicks", () => {
    expect(expectedCtr(1)).toBeGreaterThan(expectedCtr(3));
    expect(expectedCtr(3)).toBeGreaterThan(expectedCtr(8));
    expect(expectedCtr(8)).toBeGreaterThan(expectedCtr(30));
    const days = [day("2026-11-01", [["/weak", 2, 1000, 3], ["/fine", 100, 1000, 3], ["/small", 0, 50, 3], ["/deep", 0, 5000, 40], ["/weak2", 5, 600, 6]])];
    const low = lowCtrPages(days);
    expect(low.map((p) => new URL(p.page).pathname)).toEqual(["/weak", "/weak2"]);
    expect(low[0]!.missedClicks).toBe(98); // 1000 * 10 % - 2
  });
});

describe("ranking opportunities", () => {
  it("lists page+query pairs ranking 4-20 with real impressions, biggest potential first", () => {
    const days = [day("2026-11-01", [], [["/a", "ماکرومه", 3, 400, 7], ["/a", "نزدیک اول", 90, 400, 1.5], ["/a", "کم‌نمایش", 0, 10, 8], ["/a", "خیلی پایین", 0, 900, 45], ["/b", "فرصت دوم", 1, 120, 12]])];
    expect(rankingOpportunities(days).map((o) => o.query)).toEqual(["ماکرومه", "فرصت دوم"]);
  });
});

describe("coverage", () => {
  it("says which days are missing", () => {
    const c = coverage([day("2026-11-01", []), day("2026-11-03", [])], dateRange("2026-11-01", "2026-11-04"));
    expect(c).toEqual({ expectedDays: 4, presentDays: 2, missing: ["2026-11-02", "2026-11-04"] });
  });
});

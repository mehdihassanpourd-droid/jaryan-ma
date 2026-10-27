import type { DayData, Metrics, PageRow, QueryRow } from "./types";

/**
 * Pure analysis of stored Search Console data. No network, no clock. Thresholds are explicit parameters with documented defaults:
 * small sites have small numbers, so every detector has a minimum-volume rule (a drop from 3 clicks to 1 is noise, not news).
 */
export interface Totals extends Metrics {
  days: number;
}

const ZERO: Metrics = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** Sums clicks and impressions; CTR is recomputed from the sums and the position is impressions-weighted (never an average of averages). */
export function combine(rows: Metrics[]): Metrics {
  if (rows.length === 0) return ZERO;
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const weighted = rows.reduce((n, r) => n + r.position * r.impressions, 0);
  return { clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position: impressions > 0 ? weighted / impressions : 0 };
}

export function totals(days: DayData[]): Totals {
  return { ...combine(days.flatMap((d) => d.pages)), days: days.length };
}

export function byPage(days: DayData[]): Map<string, Metrics> {
  const groups = new Map<string, PageRow[]>();
  for (const row of days.flatMap((d) => d.pages)) groups.set(row.page, [...(groups.get(row.page) ?? []), row]);
  return new Map([...groups].map(([page, rows]) => [page, combine(rows)]));
}

export function byQuery(days: DayData[]): Map<string, Metrics> {
  const groups = new Map<string, QueryRow[]>();
  for (const row of days.flatMap((d) => d.queries)) groups.set(row.query, [...(groups.get(row.query) ?? []), row]);
  return new Map([...groups].map(([query, rows]) => [query, combine(rows)]));
}

export function byPageQuery(days: DayData[]): Map<string, Metrics & { page: string; query: string }> {
  const groups = new Map<string, QueryRow[]>();
  for (const row of days.flatMap((d) => d.queries)) groups.set(`${row.page}\u0000${row.query}`, [...(groups.get(`${row.page}\u0000${row.query}`) ?? []), row]);
  return new Map([...groups].map(([key, rows]) => [key, { ...combine(rows), page: rows[0]!.page, query: rows[0]!.query }]));
}

/** Relative change (current vs previous); null when there is nothing to compare with. */
export const change = (current: number, previous: number): number | null => (previous > 0 ? (current - previous) / previous : null);

export interface Drop {
  scope: "site" | "page";
  page: string | null;
  current: Metrics;
  previous: Metrics;
  clicksChange: number;
  impressionsChange: number | null;
  positionChange: number;
  /** Lost nearly everything (≥ 80 %). */
  severity: "high" | "medium";
}

export interface DropOptions {
  /** Relative click loss that counts (default 30 %). */
  dropRatio?: number;
  /** The previous period needs at least this many clicks (default 10), and the loss at least `minLost` clicks (default 5). */
  minPreviousClicks?: number;
  minLost?: number;
}

/** Site-wide and per-page traffic drops between two equally long periods. */
export function detectTrafficDrops(current: DayData[], previous: DayData[], options: DropOptions = {}): Drop[] {
  const { dropRatio = 0.3, minPreviousClicks = 10, minLost = 5 } = options;
  const drops: Drop[] = [];
  const consider = (scope: Drop["scope"], page: string | null, cur: Metrics, prev: Metrics) => {
    const lost = prev.clicks - cur.clicks;
    const rel = change(cur.clicks, prev.clicks);
    if (prev.clicks < minPreviousClicks || lost < minLost || rel === null || rel > -dropRatio) return;
    drops.push({
      scope,
      page,
      current: cur,
      previous: prev,
      clicksChange: rel,
      impressionsChange: change(cur.impressions, prev.impressions),
      positionChange: cur.position - prev.position,
      severity: rel <= -0.8 ? "high" : "medium",
    });
  };
  consider("site", null, combine(current.flatMap((d) => d.pages)), combine(previous.flatMap((d) => d.pages)));
  const now = byPage(current);
  for (const [page, prev] of byPage(previous)) consider("page", page, now.get(page) ?? ZERO, prev);
  return drops.sort((a, b) => b.previous.clicks - b.current.clicks - (a.previous.clicks - a.current.clicks) || (a.page ?? "") .localeCompare(b.page ?? ""));
}

/**
 * Typical click-through rate by average position (a coarse, conservative curve used only to spot pages that under-perform for where they
 * rank; it is a heuristic, not a measurement of this site).
 */
export function expectedCtr(position: number): number {
  const table: Array<[number, number]> = [[1.5, 0.28], [2.5, 0.15], [3.5, 0.1], [4.5, 0.07], [5.5, 0.05], [6.5, 0.04], [7.5, 0.03], [8.5, 0.025], [9.5, 0.02], [10.5, 0.018], [20.5, 0.01]];
  for (const [limit, ctr] of table) if (position < limit) return ctr;
  return 0.005;
}

export interface LowCtrPage {
  page: string;
  metrics: Metrics;
  expectedCtr: number;
  /** Clicks the page would get at the expected CTR minus what it gets (an estimate). */
  missedClicks: number;
}

export interface LowCtrOptions {
  minImpressions?: number;
  /** Counts when the CTR is below this share of the expected one (default 60 %). */
  ratio?: number;
  /** Only pages that rank on the first two result pages (default positions ≤ 20): below that CTR means little. */
  maxPosition?: number;
}

/** Pages with many impressions but a click-through rate well under what their position usually earns. */
export function lowCtrPages(days: DayData[], options: LowCtrOptions = {}): LowCtrPage[] {
  const { minImpressions = 200, ratio = 0.6, maxPosition = 20 } = options;
  const out: LowCtrPage[] = [];
  for (const [page, m] of byPage(days)) {
    if (m.impressions < minImpressions || m.position > maxPosition || m.position === 0) continue;
    const expected = expectedCtr(m.position);
    if (m.ctr >= expected * ratio) continue;
    out.push({ page, metrics: m, expectedCtr: expected, missedClicks: Math.max(0, Math.round(m.impressions * expected - m.clicks)) });
  }
  return out.sort((a, b) => b.missedClicks - a.missedClicks || a.page.localeCompare(b.page));
}

export interface Opportunity {
  page: string;
  query: string;
  metrics: Metrics;
  /** Extra clicks a position-3 ranking would bring (an estimate). */
  potentialClicks: number;
}

export interface OpportunityOptions {
  minImpressions?: number;
  /** Between page 1's lower half and page 2 (default 4–20). */
  minPosition?: number;
  maxPosition?: number;
}

/** Queries a page already ranks for, but not yet in the top results: the cheapest growth. */
export function rankingOpportunities(days: DayData[], options: OpportunityOptions = {}): Opportunity[] {
  const { minImpressions = 50, minPosition = 4, maxPosition = 20 } = options;
  const out: Opportunity[] = [];
  for (const row of byPageQuery(days).values()) {
    if (row.impressions < minImpressions || row.position < minPosition || row.position > maxPosition) continue;
    const potential = Math.round(row.impressions * expectedCtr(3) - row.clicks);
    if (potential <= 0) continue;
    out.push({ page: row.page, query: row.query, metrics: { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }, potentialClicks: potential });
  }
  return out.sort((a, b) => b.potentialClicks - a.potentialClicks || a.query.localeCompare(b.query));
}

export interface Coverage {
  expectedDays: number;
  presentDays: number;
  missing: string[];
}

/** Which days of `[start, end]` have data (so a report can say "3 of 7 days" instead of pretending). */
export function coverage(days: DayData[], dates: string[]): Coverage {
  const have = new Set(days.map((d) => d.date));
  return { expectedDays: dates.length, presentDays: dates.filter((d) => have.has(d)).length, missing: dates.filter((d) => !have.has(d)) };
}

export function topBy<T>(map: Map<string, Metrics & T>, limit: number, key: "clicks" | "impressions" = "clicks"): Array<[string, Metrics & T]> {
  return [...map].sort((a, b) => b[1][key] - a[1][key] || b[1].impressions - a[1].impressions || a[0].localeCompare(b[0])).slice(0, limit);
}

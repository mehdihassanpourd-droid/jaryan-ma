import { addDays, dateRange, type DayData, type PageRow, type QueryRow } from "./types";

/**
 * SYNTHETIC Search Console-shaped data for tests and for previewing the reports. Clearly labelled `source: "fixture"`; it is
 * generated, deterministic (seeded) and designed to contain the situations the detectors look for. It is never written to the real
 * history and never presented as real traffic.
 */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

export interface FixturePage {
  url: string;
  /** Impressions per day (before noise). */
  impressions: number;
  ctr: number;
  position: number;
  queries: Array<{ query: string; share: number; position: number }>;
  /** From this date on the page loses most of its traffic (a designed drop). */
  dropFrom?: string;
  /** From this date on the CTR is multiplied (a designed improvement after an approved edit). */
  ctrBoostFrom?: { date: string; factor: number };
}

export function fixtureDays(options: { start: string; end: string; siteUrl: string; pages: FixturePage[]; seed?: number }): DayData[] {
  const random = rng(options.seed ?? 7);
  return dateRange(options.start, options.end).map((date) => {
    const pages: PageRow[] = [];
    const queries: QueryRow[] = [];
    for (const p of options.pages) {
      const noise = 0.85 + random() * 0.3;
      const dropped = p.dropFrom !== undefined && date >= p.dropFrom;
      const boosted = p.ctrBoostFrom !== undefined && date >= p.ctrBoostFrom.date;
      const impressions = Math.round(p.impressions * noise * (dropped ? 0.5 : 1));
      const ctr = p.ctr * (boosted ? p.ctrBoostFrom!.factor : 1) * (dropped ? 0.3 : 1);
      const clicks = Math.round(impressions * ctr);
      pages.push({ page: p.url, clicks, impressions, ctr: impressions > 0 ? clicks / impressions : 0, position: p.position + (dropped ? 4 : 0) });
      for (const q of p.queries) {
        const qi = Math.round(impressions * q.share);
        const qc = Math.round(qi * ctr);
        if (qi > 0) queries.push({ page: p.url, query: q.query, clicks: qc, impressions: qi, ctr: qc / qi, position: q.position });
      }
    }
    return { date, fetchedAt: `${addDays(date, 3)}T05:00:00.000Z`, source: "fixture" as const, siteUrl: options.siteUrl, pages, queries };
  });
}

/** A small, realistic-looking storefront: strong pages, one that collapses, one under-performing for its rank, one with a near-top query. */
export function demoFixture(origin: string, end: string, days = 70): DayData[] {
  return fixtureDays({
    start: addDays(end, -(days - 1)),
    end,
    siteUrl: `${origin}/`,
    pages: [
      { url: `${origin}/`, impressions: 400, ctr: 0.06, position: 5.2, queries: [{ query: "جریان ما", share: 0.5, position: 1.4 }] },
      { url: `${origin}/products/ماکرومه-قوسی`, impressions: 260, ctr: 0.012, position: 6.1, queries: [{ query: "ماکرومه قوسی", share: 0.4, position: 6.0 }, { query: "خرید ماکرومه", share: 0.2, position: 9.5 }] },
      { url: `${origin}/products/دیوارکوب-بافته-پاییزی`, impressions: 180, ctr: 0.09, position: 3.3, queries: [{ query: "دیوارکوب بافته", share: 0.3, position: 3.1 }] },
      { url: `${origin}/category/دیوارکوب`, impressions: 220, ctr: 0.05, position: 7.4, queries: [{ query: "دیوارکوب دست‌بافت", share: 0.5, position: 7.0 }], dropFrom: addDays(end, -9) },
    ],
  });
}

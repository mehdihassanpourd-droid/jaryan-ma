import { combine, change } from "./analysis";
import type { FileMetricsStore } from "./store";
import type { LedgerEntry } from "./proposals";
import { addDays, daysBetween, type Metrics } from "./types";

/**
 * Did an APPROVED improvement help? An improvement is approved when its pull request is merged (the date comes from git). The page's
 * metrics over the 28 days before approval are compared with the days after it (a few days are skipped for the rebuild and re-crawl),
 * at 14 and 28 days, and set against the whole site's CTR change over the same days so a site-wide swing is not credited to the edit.
 * This is evidence, not proof: the report says so.
 */
export const HORIZONS = [14, 28] as const;
export const SETTLE_DAYS = 3;
/** Search Console data is final about this many days late. */
export const DATA_LAG_DAYS = 3;
export const MIN_IMPRESSIONS = 100;

export type Verdict = "improved" | "worse" | "neutral" | "insufficient_data";

export interface Evaluation {
  horizon: number;
  status: "pending" | "measured";
  /** Date the horizon's window is complete (and its data final). */
  availableOn: string;
  before?: Metrics;
  after?: Metrics;
  ctrChange?: number | null;
  /** CTR change relative to the whole site's over the same windows. */
  adjustedCtrChange?: number | null;
  clicksChange?: number | null;
  impressionsChange?: number | null;
  positionChange?: number;
  verdict?: Verdict;
}

export interface TrackedImprovement {
  entry: LedgerEntry;
  /** null = not merged yet (still only a proposal). */
  approvedAt: string | null;
  evaluations: Evaluation[];
}

/** `before` and `after` are per-day rates, so the volume rule is per day too (`horizon` days of impressions must reach the minimum). */
export function judge(before: Metrics, after: Metrics, ctrAdjusted: number | null, impressionsChange: number | null, horizon = 1): Verdict {
  if (before.impressions * horizon < MIN_IMPRESSIONS || after.impressions * horizon < MIN_IMPRESSIONS || ctrAdjusted === null) return "insufficient_data";
  const volumeKept = impressionsChange === null || impressionsChange > -0.3;
  if (ctrAdjusted >= 0.1 && volumeKept) return "improved";
  if (ctrAdjusted <= -0.1) return "worse";
  return "neutral";
}

type Days = Awaited<ReturnType<FileMetricsStore["range"]>>;
/** Volume per day with data: windows of different length (or with missing days) stay comparable. CTR and position are already ratios. */
const perDay = (m: Metrics, days: number): Metrics => (days > 0 ? { ...m, clicks: m.clicks / days, impressions: m.impressions / days } : m);

export async function trackImprovement(entry: LedgerEntry, approvedAt: string | null, store: FileMetricsStore, today: string): Promise<TrackedImprovement> {
  if (!approvedAt) return { entry, approvedAt: null, evaluations: [] };
  const evaluations: Evaluation[] = [];
  const pageOf = (days: Days) => combine(days.flatMap((d) => d.pages.filter((p) => p.page === entry.page)));
  const siteOf = (days: Days) => combine(days.flatMap((d) => d.pages));
  const baselineDays = Math.max(1, daysBetween(entry.baseline.start, entry.baseline.end) + 1);
  for (const horizon of HORIZONS) {
    // The same number of days before approval as after it (never a 28-day sum against a 14-day sum).
    const beforeDays = await store.range(addDays(approvedAt, -horizon), addDays(approvedAt, -1));
    const start = addDays(approvedAt, SETTLE_DAYS);
    const end = addDays(start, horizon - 1);
    const availableOn = addDays(end, DATA_LAG_DAYS);
    if (today < availableOn) {
      evaluations.push({ horizon, status: "pending", availableOn });
      continue;
    }
    const afterDays = await store.range(start, end);
    // The proposal's own baseline (a per-day rate) is used when the days before approval are not in the store.
    const haveBefore = beforeDays.length >= Math.ceil(horizon / 2);
    const before = haveBefore ? perDay(pageOf(beforeDays), beforeDays.length) : perDay({ clicks: entry.baseline.clicks, impressions: entry.baseline.impressions, ctr: entry.baseline.ctr, position: entry.baseline.position }, baselineDays);
    const after = perDay(pageOf(afterDays), afterDays.length);
    const siteBefore = siteOf(beforeDays);
    const siteAfter = siteOf(afterDays);
    const ctrChange = change(after.ctr, before.ctr);
    const siteChange = haveBefore ? change(siteAfter.ctr, siteBefore.ctr) : null;
    const adjusted = ctrChange === null ? null : siteChange === null ? ctrChange : (1 + ctrChange) / (1 + siteChange) - 1;
    const impressionsChange = change(after.impressions, before.impressions);
    evaluations.push({
      horizon,
      status: "measured",
      availableOn,
      before,
      after,
      ctrChange,
      adjustedCtrChange: adjusted,
      clicksChange: change(after.clicks, before.clicks),
      impressionsChange,
      positionChange: after.position - before.position,
      verdict: afterDays.length < Math.ceil(horizon / 2) ? "insufficient_data" : judge(before, after, adjusted, impressionsChange, horizon),
    });
  }
  return { entry, approvedAt, evaluations };
}

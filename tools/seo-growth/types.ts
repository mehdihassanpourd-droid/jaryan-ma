import { z } from "zod";

/**
 * Shapes shared by the SEO growth tools. Everything here is plain data: the tools never touch the storefront runtime,
 * the database or any admin API. Search Console data enters only through `gsc-client.ts` (or a clearly labelled fixture).
 */
export const metricsSchema = z.object({
  clicks: z.number().min(0),
  impressions: z.number().min(0),
  /** Fraction 0..1 (Search Console's own convention). */
  ctr: z.number().min(0).max(1),
  /** Average position (1 = top). */
  position: z.number().min(0),
});
export type Metrics = z.output<typeof metricsSchema>;

export const pageRowSchema = metricsSchema.extend({ page: z.string().url() });
export type PageRow = z.output<typeof pageRowSchema>;

export const queryRowSchema = metricsSchema.extend({ page: z.string().url(), query: z.string().min(1).max(500) });
export type QueryRow = z.output<typeof queryRowSchema>;

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One day of Search Console data for one property. `source: "fixture"` data is synthetic and never mixed with real data. */
export const dayDataSchema = z.object({
  date: z.string().regex(DATE),
  fetchedAt: z.string(),
  source: z.enum(["gsc", "fixture"]),
  siteUrl: z.string(),
  pages: z.array(pageRowSchema),
  queries: z.array(queryRowSchema),
});
export type DayData = z.output<typeof dayDataSchema>;

export type Severity = "critical" | "warning" | "info";
/** rebuild = the next site build already corrects it (the audit saw an old build); proposal = a person must approve a change; manual = needs a human decision. */
export type FixKind = "rebuild" | "proposal" | "manual";

export interface Issue {
  code: string;
  severity: Severity;
  /** The page it was found on, or "site" for site-wide problems. */
  url: string;
  message: string;
  fix: FixKind;
}

export interface AuditResult {
  date: string;
  origin: string;
  pagesChecked: number;
  issues: Issue[];
}

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** `[start, end]` inclusive list of dates. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

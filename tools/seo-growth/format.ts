const nf = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const pf = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export const fmtInt = (n: number): string => nf.format(Math.round(n));
export const fmtPos = (n: number): string => (n > 0 ? nf1.format(n) : "—");
export const fmtPct = (fraction: number): string => `${pf.format(fraction * 100)}٪`;
/** +12٫5٪ / −30٫0٪ ; "—" when there is nothing to compare. */
export const fmtChange = (fraction: number | null): string => (fraction === null ? "—" : `${fraction >= 0 ? "+" : "−"}${pf.format(Math.abs(fraction) * 100)}٪`);
export const fmtToman = (n: number): string => `${nf.format(n)} تومان`;

/** The path of a page URL, decoded for reading (`/products/ماکرومه-قوسی`). */
export function pathOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname) || "/";
  } catch {
    return url;
  }
}

/** ISO week label `2026-W44` (Monday-based), for report file names. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

import { byPage, byQuery, change, coverage, detectTrafficDrops, lowCtrPages, rankingOpportunities, topBy, totals } from "./analysis";
import { fmtChange, fmtInt, fmtPct, fmtPos, isoWeek, pathOf } from "./format";
import { countBySeverity } from "./tech-audit";
import type { FileMetricsStore } from "./store";
import type { TrackedImprovement } from "./tracking";
import { addDays, dateRange, type AuditResult, type DayData } from "./types";

export type Period = "weekly" | "monthly";

export const PERIOD_DAYS: Record<Period, number> = { weekly: 7, monthly: 28 };

export interface ReportInput {
  period: Period;
  /** Last day of the period (inclusive). */
  end: string;
  store: FileMetricsStore;
  audit: AuditResult | null;
  tracked: TrackedImprovement[];
}

export interface ReportSummary {
  period: Period;
  start: string;
  end: string;
  dataDays: number;
  expectedDays: number;
  source: "gsc" | "fixture" | "none";
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  clicksChange: number | null;
  drops: number;
  lowCtrPages: number;
  opportunities: number;
  auditCritical: number;
  auditWarnings: number;
}

export interface Report {
  markdown: string;
  summary: ReportSummary;
  /** Relative path under the data directory. */
  file: string;
}

const VERDICT_FA = { improved: "بهبود", worse: "بدتر", neutral: "بدون تغییر معنی‌دار", insufficient_data: "داده کافی نیست" } as const;
const SEVERITY_FA = { critical: "بحرانی", warning: "هشدار", info: "اطلاع" } as const;
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export async function buildReport(input: ReportInput): Promise<Report> {
  const { period, end, store, audit, tracked } = input;
  const length = PERIOD_DAYS[period];
  const start = addDays(end, -(length - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(length - 1));
  const current = await store.range(start, end);
  const previous = await store.range(prevStart, prevEnd);
  const cov = coverage(current, dateRange(start, end));
  const sources = new Set<DayData["source"]>([...current, ...previous].map((d) => d.source));
  const source: ReportSummary["source"] = sources.size === 0 ? "none" : sources.has("fixture") ? "fixture" : "gsc";

  const cur = totals(current);
  const prev = totals(previous);
  const drops = current.length > 0 && previous.length > 0 ? detectTrafficDrops(current, previous) : [];
  const low = lowCtrPages(current);
  const opps = rankingOpportunities(current);
  const label = period === "weekly" ? `هفتگی ${isoWeek(end)}` : `ماهانه ${end.slice(0, 7)}`;

  const L: string[] = [`# گزارش سئو – ${label}`, "", `بازهٔ گزارش: ${start} تا ${end} (در مقایسه با ${prevStart} تا ${prevEnd})`, ""];
  if (source === "fixture") L.push("> ⚠️ **داده‌های این گزارش آزمایشی (fixture) هستند و ترافیک یا رتبهٔ واقعی گوگل نیستند.**", "");
  if (source === "none") {
    L.push("> داده‌ای از Search Console ذخیره نشده است (اتصال هنوز انجام نشده یا روزی داده‌ای دریافت نشده). هیچ عددی ساخته نمی‌شود. راهنمای راه‌اندازی: `docs/seo/SEARCH-CONSOLE-SETUP-FA.md`.", "");
  } else {
    L.push(`پوشش داده: ${fmtInt(cov.presentDays)} از ${fmtInt(cov.expectedDays)} روز${cov.missing.length > 0 ? ` (روزهای بدون داده: ${cov.missing.join("، ")})` : ""}.`, "");
    L.push("## خلاصه", "", "| شاخص | این دوره | دورهٔ قبل | تغییر |", "|---|---:|---:|---:|");
    L.push(`| کلیک | ${fmtInt(cur.clicks)} | ${fmtInt(prev.clicks)} | ${fmtChange(change(cur.clicks, prev.clicks))} |`);
    L.push(`| نمایش | ${fmtInt(cur.impressions)} | ${fmtInt(prev.impressions)} | ${fmtChange(change(cur.impressions, prev.impressions))} |`);
    L.push(`| نرخ کلیک (CTR) | ${fmtPct(cur.ctr)} | ${fmtPct(prev.ctr)} | ${fmtChange(change(cur.ctr, prev.ctr))} |`);
    L.push(`| جایگاه میانگین | ${fmtPos(cur.position)} | ${fmtPos(prev.position)} | ${prev.position > 0 && cur.position > 0 ? `${cur.position - prev.position >= 0 ? "+" : "−"}${fmtPos(Math.abs(cur.position - prev.position))}` : "—"} |`, "");

    L.push("## افت ترافیک", "");
    if (previous.length === 0) L.push("دورهٔ قبل داده ندارد؛ مقایسه ممکن نیست.", "");
    else if (drops.length === 0) L.push("افت قابل‌توجهی دیده نشد (آستانه: ۳۰٪ و دست‌کم ۵ کلیک).", "");
    else {
      L.push("| صفحه | کلیک قبل | کلیک بعد | تغییر | شدت |", "|---|---:|---:|---:|---|");
      for (const d of drops.slice(0, 15)) L.push(`| ${d.scope === "site" ? "کل سایت" : esc(pathOf(d.page ?? ""))} | ${fmtInt(d.previous.clicks)} | ${fmtInt(d.current.clicks)} | ${fmtChange(d.clicksChange)} | ${d.severity === "high" ? "زیاد" : "متوسط"} |`);
      L.push("");
    }

    L.push("## صفحه‌های برتر", "", "| صفحه | کلیک | نمایش | CTR | جایگاه |", "|---|---:|---:|---:|---:|");
    for (const [page, m] of topBy(byPage(current), 10)) L.push(`| ${esc(pathOf(page))} | ${fmtInt(m.clicks)} | ${fmtInt(m.impressions)} | ${fmtPct(m.ctr)} | ${fmtPos(m.position)} |`);
    L.push("", "## عبارت‌های جست‌وجوی برتر", "", "| عبارت | کلیک | نمایش | CTR | جایگاه |", "|---|---:|---:|---:|---:|");
    for (const [q, m] of topBy(byQuery(current), 10)) L.push(`| ${esc(q)} | ${fmtInt(m.clicks)} | ${fmtInt(m.impressions)} | ${fmtPct(m.ctr)} | ${fmtPos(m.position)} |`);

    L.push("", "## نمایش زیاد، کلیک کم", "");
    if (low.length === 0) L.push("صفحه‌ای با نرخ کلیک بسیار کمتر از انتظار برای جایگاهش پیدا نشد.", "");
    else {
      L.push("| صفحه | نمایش | CTR | CTR مورد انتظار | جایگاه | کلیک ازدست‌رفته (تخمین) |", "|---|---:|---:|---:|---:|---:|");
      for (const p of low.slice(0, 10)) L.push(`| ${esc(pathOf(p.page))} | ${fmtInt(p.metrics.impressions)} | ${fmtPct(p.metrics.ctr)} | ${fmtPct(p.expectedCtr)} | ${fmtPos(p.metrics.position)} | ${fmtInt(p.missedClicks)} |`);
      L.push("");
    }
    L.push("## فرصت‌های رشد (رتبهٔ ۴ تا ۲۰)", "");
    if (opps.length === 0) L.push("فرصتی با نمایش کافی پیدا نشد.", "");
    else {
      L.push("| عبارت | صفحه | نمایش | جایگاه | کلیک بالقوه (تخمین) |", "|---|---|---:|---:|---:|");
      for (const o of opps.slice(0, 10)) L.push(`| ${esc(o.query)} | ${esc(pathOf(o.page))} | ${fmtInt(o.metrics.impressions)} | ${fmtPos(o.metrics.position)} | ${fmtInt(o.potentialClicks)} |`);
      L.push("");
    }
  }

  L.push("## وضعیت فنی سایت", "");
  if (!audit) L.push("بررسی فنی در این بازه اجرا نشده است (SITE_URL تنظیم نشده یا سایت در دسترس نبود).", "");
  else {
    const c = countBySeverity(audit.issues);
    L.push(`آخرین بررسی: ${audit.date} (${audit.origin}) – ${fmtInt(audit.pagesChecked)} صفحه – بحرانی: ${fmtInt(c.critical)} · هشدار: ${fmtInt(c.warning)} · اطلاع: ${fmtInt(c.info)}.`, "");
    if (audit.issues.length > 0) {
      L.push("| شدت | کد | صفحه | توضیح | رفع |", "|---|---|---|---|---|");
      for (const i of audit.issues.slice(0, 20)) L.push(`| ${SEVERITY_FA[i.severity]} | \`${i.code}\` | ${esc(i.url === "site" ? "کل سایت" : pathOf(i.url))} | ${esc(i.message)} | ${i.fix === "rebuild" ? "بازسازی سایت" : i.fix === "proposal" ? "پیشنهاد/تأیید" : "دستی"} |`);
      if (audit.issues.length > 20) L.push("", `… و ${fmtInt(audit.issues.length - 20)} مورد دیگر در فایل بررسی.`);
      L.push("");
    }
  }

  L.push("## پیگیری بهبودهای تأییدشده", "");
  if (tracked.length === 0) L.push("هنوز بهبودی ثبت نشده است.", "");
  else {
    L.push("| صفحه | تأیید | افق | CTR قبل | CTR بعد | تغییر تعدیل‌شده | نتیجه |", "|---|---|---:|---:|---:|---:|---|");
    for (const t of tracked) {
      if (!t.approvedAt) {
        L.push(`| ${esc(pathOf(t.entry.page))} | هنوز ادغام نشده | — | — | — | — | منتظر تأیید |`);
        continue;
      }
      for (const e of t.evaluations)
        L.push(`| ${esc(pathOf(t.entry.page))} | ${t.approvedAt} | ${fmtInt(e.horizon)} روز | ${e.before ? fmtPct(e.before.ctr) : "—"} | ${e.after ? fmtPct(e.after.ctr) : "—"} | ${fmtChange(e.adjustedCtrChange ?? null)} | ${e.status === "pending" ? `در انتظار داده (تا ${e.availableOn})` : VERDICT_FA[e.verdict ?? "insufficient_data"]} |`);
    }
    L.push("", "_این اندازه‌گیری شاهد است، نه اثبات: تغییر نرخ کلیک با تغییر کل سایت تعدیل شده اما فصل، رقبا و الگوریتم گوگل هم اثر دارند._", "");
  }
  L.push("---", "_نرخ کلیک مورد انتظار و کلیک بالقوه تخمین‌هایی تقریبی‌اند (منحنی عمومی نرخ کلیک بر اساس جایگاه) و فقط برای اولویت‌بندی‌اند. هیچ عددی در این گزارش ساختگی نیست؛ اگر داده‌ای نباشد گفته می‌شود._", "");

  const summary: ReportSummary = {
    period,
    start,
    end,
    dataDays: cov.presentDays,
    expectedDays: cov.expectedDays,
    source,
    clicks: cur.clicks,
    impressions: cur.impressions,
    ctr: cur.ctr,
    position: cur.position,
    clicksChange: change(cur.clicks, prev.clicks),
    drops: drops.length,
    lowCtrPages: low.length,
    opportunities: opps.length,
    auditCritical: audit ? countBySeverity(audit.issues).critical : 0,
    auditWarnings: audit ? countBySeverity(audit.issues).warning : 0,
  };
  const file = period === "weekly" ? `reports/weekly/${isoWeek(end)}` : `reports/monthly/${end.slice(0, 7)}`;
  return { markdown: `${L.join("\n")}\n`, summary, file };
}

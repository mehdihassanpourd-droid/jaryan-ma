#!/usr/bin/env node
// Reads exported probe results (JSON files, or the server's report log) and prints a go / no-go summary.
//   node scripts/summarize.mjs results/ [more files or folders] [--report-log jm-probe-report.log] [--json]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DIRECT_OPERATORS = ["mci", "irancell", "rightel", "fixed", "other"];
const MOBILE = ["mci", "irancell", "rightel"];

export function loadCriteria(path = join(HERE, "..", "criteria.json")) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** One result is valid only if it has the exported shape; anything else is ignored (and counted). */
export function isResult(r) {
  return !!r && r.tool === "jm-connectivity-probe" && r.schema === 1 && Array.isArray(r.steps) && typeof r.verdict === "string";
}

export function parseReportLog(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const encoded = line.trim().split(" ")[1];
    if (!encoded) continue;
    try {
      out.push({ ...JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")), _day: line.slice(0, 10) });
    } catch {
      /* ignore damaged lines */
    }
  }
  return out;
}

const rate = (n, d) => (d === 0 ? null : n / d);
const p95 = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
};
const stepOk = (r, id) => r.steps.find((s) => s.id === id)?.ok === true;

export function summarize(all, criteria = loadCriteria()) {
  const results = all.filter(isResult);
  const ignored = all.length - results.length;
  const seen = new Set();
  const unique = results.filter((r) => {
    const key = `${r.runId}|${r.startedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const direct = unique.filter((r) => r.meta?.vpn === "off" && DIRECT_OPERATORS.includes(r.meta?.operator));
  const vpnOn = unique.filter((r) => r.meta?.vpn === "on" && r.meta?.operator !== "abroad");
  const abroad = unique.filter((r) => r.meta?.operator === "abroad");
  const pass = (list) => list.filter((r) => r.verdict === "pass").length;

  const byOperator = {};
  for (const r of direct) {
    const k = r.meta.operator;
    byOperator[k] ??= { runs: 0, pass: 0 };
    byOperator[k].runs += 1;
    if (r.verdict === "pass") byOperator[k].pass += 1;
  }
  const days = new Set(unique.map((r) => String(r.startedAt).slice(0, 10)));
  const orderMs = direct.map((r) => r.steps.find((s) => s.id === "order")).filter((s) => s?.ok).map((s) => s.ms);
  const failures = {};
  for (const r of unique) for (const s of r.steps) if (!s.ok) failures[`${s.id}:${s.err ?? "failed"}`] = (failures[`${s.id}:${s.err ?? "failed"}`] ?? 0) + 1;

  const directRate = rate(pass(direct), direct.length);
  const paymentRate = rate(direct.filter((r) => stepOk(r, "payment")).length, direct.length);
  const vpnRate = rate(pass(vpnOn), vpnOn.length);
  const operators = Object.keys(byOperator).filter((k) => byOperator[k].runs >= 3);
  const hasMobile = operators.some((k) => MOBILE.includes(k));
  const orderP95 = p95(orderMs);

  const checks = [
    { id: "enough_runs", label: `at least ${criteria.minRunsDirect} direct runs (VPN off, inside Iran)`, ok: direct.length >= criteria.minRunsDirect, value: direct.length },
    { id: "enough_operators", label: `at least ${criteria.minOperatorsDirect} different networks with 3+ runs each`, ok: operators.length >= criteria.minOperatorsDirect, value: operators.length },
    { id: "mobile_operator", label: "at least one mobile operator tested", ok: !criteria.requireMobileOperator || hasMobile, value: hasMobile },
    { id: "direct_pass_rate", label: `direct full-pass rate >= ${criteria.directPassRateGo * 100}%`, ok: directRate !== null && directRate >= criteria.directPassRateGo, value: directRate },
    { id: "payment_round_trip", label: `payment redirect round trip >= ${criteria.paymentRoundTripRateGo * 100}%`, ok: paymentRate !== null && paymentRate >= criteria.paymentRoundTripRateGo, value: paymentRate },
    { id: "order_latency", label: `large-POST (order) p95 <= ${criteria.orderStepP95MsMax} ms`, ok: orderP95 !== null && orderP95 <= criteria.orderStepP95MsMax, value: orderP95 },
    { id: "follow_up_days", label: `results from at least ${criteria.minDaysForFollowUp} different days (7-day follow-up)`, ok: days.size >= criteria.minDaysForFollowUp, value: days.size, informational: true },
    { id: "vpn_on", label: `with VPN on (inside Iran) full-pass rate >= ${criteria.vpnPassRateOk * 100}%`, ok: vpnRate !== null && vpnRate >= criteria.vpnPassRateOk, value: vpnRate, informational: true },
  ];
  const required = checks.filter((c) => !c.informational);
  let decision;
  if (direct.length < criteria.minRunsDirect || operators.length < criteria.minOperatorsDirect) decision = "INSUFFICIENT_DATA";
  else if (directRate !== null && directRate < criteria.directPassRateNoGo) decision = "NO_GO";
  else if (required.every((c) => c.ok)) decision = checks.find((c) => c.id === "vpn_on").ok && checks.find((c) => c.id === "follow_up_days").ok ? "GO" : "GO_WITH_OPEN_ITEMS";
  else decision = "NOT_YET";

  return {
    decision,
    counts: { total: unique.length, ignored, direct: direct.length, vpnOn: vpnOn.length, abroad: abroad.length, days: days.size },
    directPassRate: directRate,
    byOperator,
    abroadPassRate: rate(pass(abroad), abroad.length),
    vpnOnPassRate: vpnRate,
    failures,
    checks,
  };
}

const TEXT = {
  GO: "GO — all required checks and the follow-up evidence are met.",
  GO_WITH_OPEN_ITEMS: "GO WITH OPEN ITEMS — required checks pass; the 7-day follow-up or the VPN-on evidence is still missing.",
  NOT_YET: "NOT YET — enough data, but at least one required check fails (see below).",
  NO_GO: "NO-GO — the direct full-pass rate is below the no-go line.",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA — not enough runs or networks to decide.",
};
const pct = (v) => (v === null || v === undefined ? "n/a" : typeof v === "number" && v <= 1 && !Number.isInteger(v) ? `${(v * 100).toFixed(0)}%` : String(v));

export function format(summary) {
  const lines = [TEXT[summary.decision], "", `runs: ${summary.counts.total} (direct ${summary.counts.direct}, VPN on ${summary.counts.vpnOn}, abroad ${summary.counts.abroad}, days ${summary.counts.days}, ignored ${summary.counts.ignored})`, ""];
  for (const c of summary.checks) lines.push(`${c.ok ? "PASS" : c.informational ? "OPEN" : "FAIL"}  ${c.label}  [${pct(c.value)}]`);
  lines.push("", "by network (direct):");
  for (const [k, v] of Object.entries(summary.byOperator)) lines.push(`  ${k}: ${v.pass}/${v.runs}`);
  const top = Object.entries(summary.failures).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (top.length) lines.push("", "most common failures:", ...top.map(([k, n]) => `  ${n} x ${k}`));
  return lines.join("\n");
}

function collectFiles(target) {
  const st = statSync(target);
  if (st.isFile()) return [target];
  return readdirSync(target).flatMap((n) => collectFiles(join(target, n)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const all = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--json") continue;
    if (args[i] === "--report-log") {
      all.push(...parseReportLog(readFileSync(args[++i], "utf8")));
      continue;
    }
    for (const f of collectFiles(args[i]).filter((x) => x.endsWith(".json"))) {
      try {
        const v = JSON.parse(readFileSync(f, "utf8"));
        all.push(...(Array.isArray(v) ? v : [v]));
      } catch {
        all.push(null);
      }
    }
  }
  const s = summarize(all);
  console.log(json ? JSON.stringify(s, null, 2) : format(s));
  process.exit(s.decision === "GO" || s.decision === "GO_WITH_OPEN_ITEMS" ? 0 : 2);
}

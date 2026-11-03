import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { format, parseReportLog, summarize } from "../scripts/summarize.mjs";

let n = 0;
function run({ operator = "mci", vpn = "off", verdict = "pass", day = "2026-11-03", payment = true, orderMs = 400 } = {}) {
  n += 1;
  const steps = ["page", "image", "catalog", "apiPing", "session", "cart"].map((id) => ({ id, ok: true, ms: 10 }));
  steps.push({ id: "order", ok: true, ms: orderMs }, payment ? { id: "payment", ok: true, ms: 50 } : { id: "payment", ok: false, ms: 0, err: "no_return" });
  return { schema: 1, tool: "jm-connectivity-probe", runId: `r${n}`, startedAt: `${day}T10:00:${String(n % 60).padStart(2, "0")}Z`, meta: { operator, vpn }, steps, verdict };
}
const many = (count, opts) => Array.from({ length: count }, () => run(opts));

describe("summarize", () => {
  const criteria = { minRunsDirect: 30, minOperatorsDirect: 3, requireMobileOperator: true, directPassRateGo: 0.95, directPassRateNoGo: 0.8, paymentRoundTripRateGo: 0.95, vpnPassRateOk: 0.8, orderStepP95MsMax: 8000, minDaysForFollowUp: 7 };
  const good = () => [...many(12, { operator: "mci" }), ...many(10, { operator: "irancell" }), ...many(10, { operator: "fixed" })];

  it("says INSUFFICIENT_DATA with few runs", () => assert.equal(summarize(many(5), criteria).decision, "INSUFFICIENT_DATA"));
  it("says GO_WITH_OPEN_ITEMS when direct checks pass but VPN and 7-day evidence are missing", () => assert.equal(summarize(good(), criteria).decision, "GO_WITH_OPEN_ITEMS"));
  it("says GO with VPN-on evidence over 7 days", () => {
    const days = Array.from({ length: 7 }, (_, i) => `2026-11-0${i + 1}`);
    const all = [...good().map((r, i) => ({ ...r, startedAt: `${days[i % 7]}T10:00:${String(i).padStart(2, "0")}Z` })), ...many(5, { vpn: "on" })];
    assert.equal(summarize(all, criteria).decision, "GO");
  });
  it("says NO_GO when most direct runs fail", () => {
    const all = [...many(10, { operator: "mci", verdict: "fail" }), ...many(10, { operator: "irancell", verdict: "fail" }), ...many(10, { operator: "fixed", verdict: "pass" })];
    assert.equal(summarize(all, criteria).decision, "NO_GO");
  });
  it("says NOT_YET when the payment round trip is weak", () => {
    const all = [...many(12, { operator: "mci", payment: false }), ...many(10, { operator: "irancell" }), ...many(10, { operator: "fixed" })];
    const s = summarize(all, criteria);
    assert.equal(s.decision, "NOT_YET");
    assert.equal(s.checks.find((c) => c.id === "payment_round_trip").ok, false);
  });
  it("needs a mobile operator", () => {
    const all = [...many(12, { operator: "fixed" }), ...many(10, { operator: "other" }), ...many(10, { operator: "rightel", verdict: "pass" })];
    assert.equal(summarize(all.filter((r) => r.meta.operator !== "rightel"), criteria).decision, "INSUFFICIENT_DATA");
  });
  it("ignores foreign files and duplicates, and counts runs from abroad separately", () => {
    const base = good();
    const s = summarize([...base, base[0], { hello: 1 }, null, ...many(3, { operator: "abroad" })], criteria);
    assert.equal(s.counts.ignored, 2);
    assert.equal(s.counts.direct, 32);
    assert.equal(s.counts.abroad, 3);
  });
  it("reads the server's report log and prints text", () => {
    const r = run();
    const line = `2026-11-03T10:00:00+00:00 ${Buffer.from(JSON.stringify(r)).toString("base64url")}\nnot a line\n`;
    const parsed = parseReportLog(line);
    assert.equal(parsed.length, 1);
    assert.match(format(summarize(parsed, criteria)), /INSUFFICIENT DATA/);
  });
});

#!/usr/bin/env node
// Entry point used by the workflows. All inputs come from environment variables (never from the command line, never echoed),
// the API key only from ARVAN_API_KEY. With no key it does nothing and succeeds, so the scheduled sweeper is harmless until
// the owner has added the secret.
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lookup } from "node:dns/promises";
import { randomBytes } from "node:crypto";
import { createClient, DEFAULT_BASE } from "./lib/arvan.mjs";
import { CONFIRM_PHRASE, costCeiling } from "./lib/cost.mjs";
import { collect, deploy, destroy, dryRun, explainAuth, hosts, regionCodeOf } from "./lib/orchestrator.mjs";
import { createSshRemote } from "./lib/remote.mjs";
import { describe, sweep } from "./lib/reaper.mjs";
import { loadCriteria } from "../scripts/summarize.mjs";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..");

function stagePackage() {
  const dir = mkdtempSync(join(tmpdir(), "jm-pkg-"));
  for (const d of ["web", "nginx", "scripts"]) cpSync(join(PKG, d), join(dir, d), { recursive: true });
  return dir;
}

async function regionCodes(client, region) {
  if (region) return [region];
  const list = await client.regions();
  const codes = list.map(regionCodeOf).filter(Boolean).map(String);
  if (codes.length === 0) throw new Error("the account has no regions to look in");
  return codes;
}

async function resolveDns({ hosts: names, ip }) {
  for (let i = 0; i < 30; i++) {
    const ok = await Promise.all(names.map((h) => lookup(h, { family: 4 }).then((r) => r.address === ip, () => false)));
    if (ok.every(Boolean)) return;
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error(`the names ${names.join(", ")} do not resolve to ${ip}; point them at the server and run again`);
}

export async function main(env, deps = {}) {
  const action = env.PROBE_ACTION ?? "";
  const out = { action, ok: false };
  const outDir = env.PROBE_OUT_DIR ?? "probe-out";
  mkdirSync(outDir, { recursive: true });
  const finish = (code, text) => {
    writeFileSync(join(outDir, "report.json"), JSON.stringify(out, null, 2));
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### جریان ما — probe: ${action}\n\n\`\`\`\n${text}\n\`\`\`\n`);
    console.log(text);
    return code;
  };

  if (!env.ARVAN_API_KEY) {
    out.skipped = "no ARVAN_API_KEY secret is configured";
    out.ok = true;
    return finish(0, "SKIPPED: no ARVAN_API_KEY secret is configured yet. Nothing was done.");
  }
  const apiKey = env.ARVAN_API_KEY;
  const region = env.PROBE_REGION ?? "";
  const client = deps.client ?? createClient({ apiKey, base: env.ARVAN_API_BASE ?? DEFAULT_BASE });
  const plan = {
    hourlyRateIrr: Number(env.PROBE_HOURLY_RATE_IRR ?? NaN), maxHours: Number(env.PROBE_MAX_HOURS ?? NaN),
    extraIrrPerHour: Number(env.PROBE_EXTRA_IRR_PER_HOUR ?? 0), confirm: env.PROBE_CONFIRM ?? "",
  };
  const remoteFactory = deps.remoteFactory ?? (({ ip, identity }) => createSshRemote({ ip, identity }));
  try {
    if (action !== "dry-run") {
      // every other action first finds the header form the server accepts (read-only requests); a failure here is loud
      const auth = await client.detectAuth();
      if (!auth.ok) {
        out.error = `authentication failed: ${explainAuth(auth)}`;
        return finish(1, `ERROR: ${out.error}`);
      }
    }
    if (action === "dry-run") {
      Object.assign(out, await dryRun({ client, region }));
      return finish(out.ok ? 0 : 1, out.checks.map((c) => `${c.ok ? "OK  " : "FAIL"} ${c.name}: ${c.detail}`).join("\n"));
    }
    if (action === "deploy") {
      const r = await deploy({
        client, region, apiKey, plan, domain: env.PROBE_DOMAIN, certMode: env.PROBE_CERT_MODE ?? "letsencrypt", dns: env.PROBE_DNS ?? "none",
        remoteFactory, packageDir: deps.packageDir ?? stagePackage(), runId: deps.runId ?? randomBytes(4).toString("hex"), resolveDns: deps.resolveDns ?? resolveDns, sleep: deps.sleep,
      });
      Object.assign(out, r);
      const text = [`${r.ok ? "DEPLOYED" : "FAILED"} ${r.name ?? ""}`, `expires: ${r.expiresAt}`, `software cost ceiling: ${r.ceilingIrr} IRR (time-based; NOT a wallet limit)`, ...r.steps.map((s) => `- ${s.name} ${s.detail}`), r.cleanup ? describe(r.cleanup) : ""].join("\n");
      return finish(r.ok ? 0 : 1, text);
    }
    if (action === "collect") {
      let r = { action: "collect", ok: true, skipped: "no probe server exists" };
      for (const code of await regionCodes(client, region)) {
        r = await collect({ client, region: code, apiKey, remoteFactory, outDir, criteria: loadCriteria() });
        if (!r.skipped) break;
      }
      Object.assign(out, r);
      return finish(r.ok ? 0 : 1, JSON.stringify(r));
    }
    if (action === "destroy" || action === "sweep") {
      // no region given: look in EVERY region the account has, so the clean-up needs no setting from anyone
      const reports = [];
      for (const code of await regionCodes(client, region)) {
        reports.push(action === "destroy"
          ? await destroy({ client, region: code, domain: env.PROBE_DOMAIN, dns: env.PROBE_DNS ?? "none", plan: Number.isFinite(plan.maxHours) ? plan : undefined, sleep: deps.sleep })
          : await sweep({ client, region: code, force: false, sleep: deps.sleep }));
      }
      Object.assign(out, { action, ok: reports.every((x) => x.ok), regions: reports });
      return finish(out.ok ? 0 : 1, reports.length ? reports.map(describe).join("\n") : "no region found");
    }
    out.error = `unknown action: ${action}`;
    return finish(2, out.error);
  } catch (e) {
    out.error = String(e.message).split(apiKey).join("[redacted]");
    return finish(e.code === "invalid-input" ? 2 : 1, `ERROR: ${out.error}`);
  }
}

export { CONFIRM_PHRASE, costCeiling, hosts };
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(await main(process.env));

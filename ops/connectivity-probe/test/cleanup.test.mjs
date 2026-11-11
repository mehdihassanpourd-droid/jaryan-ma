// Regression tests for the scheduled "Probe cleanup" failures (run 42979673513 and the 59 before it).
// A real ArvanCloud account showed: servers, volumes and snapshots list fine in all six regions (nothing of ours there), but
//   GET .../floating-ips -> 404 (the path does not exist)   and   GET .../ssh-keys -> 403 (the read-only role may not list them).
// The sweeper treated "cannot list" as "not clean" for EVERY kind, so it failed on every run for a reason that was not a problem.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createClient } from "../automation/lib/arvan.mjs";
import { makeName } from "../automation/lib/cost.mjs";
import { dryRun } from "../automation/lib/orchestrator.mjs";
import { describe as describeSweep, sweep } from "../automation/lib/reaper.mjs";
import { main } from "../automation/cli.mjs";
import { startMockArvan } from "../automation/mock-arvan.mjs";
import { PKG } from "./helpers.mjs";

const REGION = "ir-test-1";
const HOUR = 3600000;
const now = Date.UTC(2026, 10, 11);
let mock, c, sleeps;
const sleep = async (ms) => { sleeps.push(ms); };
beforeEach(async () => {
  mock = await startMockArvan();
  sleeps = [];
  c = createClient({ apiKey: mock.apiKey, base: mock.base, sleep: async () => {}, retries: 1 });
});
afterEach(() => mock.close());
const realWorld = () => { mock.state.faults.kindStatus.set("floating-ips", 404); mock.state.faults.kindStatus.set("ssh-keys", 403); };

describe("sweep when nothing exists", () => {
  it("is clean, deletes nothing, takes one pass and never sleeps", async () => {
    const r = await sweep({ client: c, region: REGION, now, sleep });
    assert.equal(r.ok, true);
    assert.equal(r.attempts, 1);
    assert.deepEqual(sleeps, []);
    assert.equal(mock.mutations().length, 0);
    assert.equal(r.deleted.length + r.leftover.length + r.listErrors.length, 0);
  });
});

describe("kinds the API does not offer to this key (the real-world 404 and 403)", () => {
  it("reports them as NOT CHECKED, not as a failure, and stays clean when nothing exists", async () => {
    realWorld();
    const r = await sweep({ client: c, region: REGION, now, sleep });
    assert.equal(r.ok, true);
    assert.deepEqual(r.unverified.map((x) => `${x.kind}:${x.status}`).sort(), ["floating-ips:404", "ssh-keys:403"]);
    assert.equal(r.listErrors.length, 0);
    const text = describeSweep(r);
    assert.match(text, /NOT CHECKED \(not an error\): floating-ips/);
    assert.match(text, /NOT CHECKED \(not an error\): ssh-keys/);
    assert.equal(text.includes("NOT confirmed clean"), false);
  });
  it("does not retry or sleep for an endpoint that will answer the same way again (the old run spent 3.5 minutes on this)", async () => {
    realWorld();
    const r = await sweep({ client: c, region: REGION, now, sleep });
    assert.equal(r.attempts, 1);
    assert.deepEqual(sleeps, []);
  });
  it("still deletes an expired server while those two kinds cannot be listed", async () => {
    realWorld();
    mock.add("servers", makeName("old00000", now - HOUR));
    const r = await sweep({ client: c, region: REGION, now, sleep });
    assert.equal(r.ok, true);
    assert.equal(r.deleted.length, 1);
    assert.equal(mock.state.store.servers.length, 0);
  });
  it("a refused or missing REQUIRED kind (server, disk, snapshot) is still a failure: unknown is never clean", async () => {
    for (const [kind, status] of [["servers", 403], ["volumes", 404], ["snapshots", 403]]) {
      mock.state.faults.kindStatus.clear();
      mock.state.faults.kindStatus.set(kind, status);
      const r = await sweep({ client: c, region: REGION, now, sleep });
      assert.equal(r.ok, false, kind);
      assert.equal(r.listErrors[0].kind, kind);
      assert.match(describeSweep(r), /NOT confirmed clean/);
    }
  });
  it("a transient error (HTTP 500) on an optional kind is retried and then reported as a failure", async () => {
    mock.state.faults.kindStatus.set("ssh-keys", 500);
    const r = await sweep({ client: c, region: REGION, now, sleep, attempts: 3 });
    assert.equal(r.ok, false);
    assert.equal(r.unverified.length, 0);
    assert.equal(r.listErrors[0].kind, "ssh-keys");
    assert.equal(r.attempts, 3);
    assert.ok(sleeps.length >= 2, "it did back off and retry");
  });
});

describe("the same behaviour through the cli and the dry-run", () => {
  const env = (extra = {}) => ({ PROBE_ACTION: "sweep", PROBE_OUT_DIR: mkdtempSync(join(tmpdir(), "jm-cl-")), PROBE_REGION: "", ARVAN_API_KEY: mock.apiKey, ARVAN_API_BASE: mock.base, ...extra });

  it("sweep over every region exits 0 with no resources even though two kinds cannot be listed", async () => {
    realWorld();
    mock.state.regions = [{ code: "ir-a" }, { code: "ir-b" }, { code: "eu-c" }];
    const e = env();
    assert.equal(await main(e, { sleep }), 0);
    const report = JSON.parse(readFileSync(join(e.PROBE_OUT_DIR, "report.json"), "utf8"));
    assert.equal(report.ok, true);
    assert.equal(report.regions.length, 3);
    assert.equal(mock.mutations().length, 0, "a sweep with nothing to delete sends no create or delete");
  });
  it("a real leftover is still a failure (exit 1)", async () => {
    realWorld();
    mock.add("servers", makeName("old00000", Date.now() - HOUR));
    mock.state.faults.permanentDelete.add("servers");
    assert.equal(await main(env({ PROBE_REGION: REGION }), { sleep }), 1);
  });
  it("the dry-run reports the two kinds as not checked and still passes", async () => {
    realWorld();
    const r = await dryRun({ client: c, region: REGION });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.match(r.checks.find((x) => x.name === "list ssh-keys").detail, /NOT CHECKED \(HTTP 403\)/);
    assert.match(r.checks.find((x) => x.name === "list floating-ips").detail, /NOT CHECKED \(HTTP 404\)/);
  });
});

describe("the alert issue (not one comment every 3 hours)", () => {
  const t = readFileSync(join(PKG, "..", "..", ".github", "workflows", "probe-cleanup.yml"), "utf8");
  it("adds a comment only when the issue is older than 20 hours, and opens one issue when none exists", () => {
    assert.match(t, /updatedAt/);
    assert.match(t, /-gt 72000/);
    assert.match(t, /gh issue create/);
  });
  it("closes the alert on a confirmed-clean sweep, but never on a skipped run", () => {
    assert.match(t, /if: \$\{\{ success\(\) \}\}/);
    assert.match(t, /gh issue close/);
    assert.match(t, /grep -q '"skipped"' probe-out\/report\.json/);
  });
  it("still has minimal permissions (issues: write only) and no deploy action", () => {
    assert.match(t, /permissions:\n  contents: read\n  issues: write/);
    assert.equal(/PROBE_ACTION: (deploy|destroy)/.test(t), false);
  });
});

// Static safety checks on the three probe workflows (they hold the only secret the automation uses).
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PKG } from "./helpers.mjs";

const DIR = join(PKG, "..", "..", ".github", "workflows");
const names = ["probe-trial.yml", "probe-cleanup.yml", "probe-collect.yml"];
const text = Object.fromEntries(names.map((n) => [n, readFileSync(join(DIR, n), "utf8")]));

describe("probe workflows", () => {
  for (const n of names) {
    const t = text[n];
    it(`${n}: no pull_request trigger (a secret is never exposed to a fork or a branch) and no pull_request_target`, () => {
      assert.equal(/^\s*pull_request/m.test(t), false);
      assert.equal(/^\s*push:/m.test(t), false);
    });
    it(`${n}: actions are pinned to a commit SHA and permissions are minimal`, () => {
      for (const m of t.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, m[1]);
      assert.match(t, /^permissions:\n  contents: read/m);
      assert.equal(/contents:\s*write|packages:|id-token:|actions:\s*write/.test(t), false);
    });
    it(`${n}: the secret is only mapped into one env variable, never used in a run line, never echoed`, () => {
      assert.equal((t.match(/secrets\.[A-Z_]+/g) ?? []).every((s) => s === "secrets.ARVAN_API_KEY"), true);
      assert.equal(/run:[^\n]*secrets\./.test(t), false);
      assert.equal(/echo[^\n]*ARVAN_API_KEY/.test(t), false);
      assert.equal(/set -x|--debug/.test(t), false);
    });
    it(`${n}: user inputs reach the program through env variables only, not through shell text`, () => {
      const runBlocks = [...t.matchAll(/run:\s*(\|[^\n]*\n(?:[ ]{10,}[^\n]*\n?)+|[^\n]+)/g)].map((m) => m[1]).join("\n");
      assert.equal(/\$\{\{\s*inputs\./.test(runBlocks), false);
      assert.equal(/\$\{\{\s*github\.event/.test(runBlocks), false);
    });
    it(`${n}: no artifact is built from a key or ssh directory`, () => {
      assert.equal(/\.ssh|id_ed25519|privkey/.test(t), false);
    });
  }
  it("deploy needs a person: the trial workflow is workflow_dispatch only", () => {
    assert.match(text["probe-trial.yml"], /on:\n  workflow_dispatch:/);
    assert.equal(/schedule:/.test(text["probe-trial.yml"]), false);
  });
  it("the sweeper runs on a schedule, can only open issues, and tells the owner when clean-up is unconfirmed", () => {
    const t = text["probe-cleanup.yml"];
    assert.match(t, /cron:/);
    assert.match(t, /issues: write/);
    assert.match(t, /gh issue/);
    assert.equal(/PROBE_ACTION: (deploy|destroy)/.test(t), false, "the schedule only sweeps expired resources, it never deploys");
  });
  it("a failed or cancelled deploy triggers an immediate removal step", () => {
    assert.match(text["probe-trial.yml"], /failure\(\) \|\| cancelled\(\)[\s\S]*PROBE_ACTION: destroy/);
  });
  it("the repository contains no other workflow that can reach the secret", () => {
    for (const f of readdirSync(DIR)) if (!names.includes(f)) assert.equal(readFileSync(join(DIR, f), "utf8").includes("ARVAN_API_KEY"), false, f);
  });
});

// Tests for the deployment automation, against a FAKE ArvanCloud API on 127.0.0.1 (no real account, no secret, no cost).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { createClient } from "../automation/lib/arvan.mjs";
import { buildUserData } from "../automation/lib/cloudinit.mjs";
import { CONFIRM_PHRASE, HARD_MAX_HOURS, costCeiling, isExpired, makeName, parseName, validatePlan } from "../automation/lib/cost.mjs";
import { collect, deploy, destroy, dryRun, pickFlavor } from "../automation/lib/orchestrator.mjs";
import { describe as describeSweep, sweep } from "../automation/lib/reaper.mjs";
import { deriveIdentity, knownHostsLine, openSshPrivate, publicLine } from "../automation/lib/sshkey.mjs";
import { sshArgs } from "../automation/lib/remote.mjs";
import { main } from "../automation/cli.mjs";
import { startMockArvan } from "../automation/mock-arvan.mjs";
import { PKG } from "./helpers.mjs";

const REGION = "ir-test-1";
const noSleep = async () => {};
const PLAN = { hourlyRateIrr: 13860, maxHours: 48, extraIrrPerHour: 0, confirm: CONFIRM_PHRASE };
const HOUR = 3600000;

function fakeRemote(overrides = {}) {
  const log = { commands: [], puts: [], closed: false };
  const remote = {
    run: async (c) => { log.commands.push(c); return /self-check/.test(c) ? "PASS x\nALL CHECKS PASSED\n" : ""; },
    waitReady: async () => {},
    put: async (a, b) => { log.puts.push([a, b]); },
    get: async () => `2026-11-03T10:00:00+00:00 ${Buffer.from(JSON.stringify({ schema: 1, tool: "jm-connectivity-probe", runId: "r1", startedAt: "2026-11-03T10:00:00Z", meta: { operator: "mci", vpn: "off" }, steps: [{ id: "page", ok: true, ms: 1 }], verdict: "pass" })).toString("base64url")}\n`,
    close: () => { log.closed = true; },
    ...overrides,
  };
  return { remote, log };
}

describe("cost guard (software-enforced; the wallet is never treated as a ceiling)", () => {
  it("rejects bad inputs and requires the exact confirmation phrase", () => {
    assert.deepEqual(validatePlan(PLAN), []);
    assert.ok(validatePlan({ ...PLAN, confirm: "yes" }).length);
    assert.ok(validatePlan({ ...PLAN, maxHours: HARD_MAX_HOURS + 1 }).length);
    assert.ok(validatePlan({ ...PLAN, maxHours: 0 }).length);
    assert.ok(validatePlan({ ...PLAN, maxHours: 1.5 }).length);
    assert.ok(validatePlan({ ...PLAN, hourlyRateIrr: 13860000 }).length, "a rate typed with extra zeros is refused");
    assert.ok(validatePlan({ ...PLAN, hourlyRateIrr: NaN }).length);
  });
  it("computes a ceiling above the plain price for the allowed hours", () => {
    assert.ok(costCeiling(PLAN) >= 13860 * 48);
    assert.ok(costCeiling(PLAN) <= 13860 * 50 * 1.1 + 1);
  });
  it("encodes the expiry in the resource name and parses it back; unreadable expiry fails closed", () => {
    const at = Date.UTC(2026, 10, 5, 12);
    const name = makeName("abcd1234", at);
    assert.equal(parseName(name).expiresAtMs, at);
    assert.equal(isExpired(name, at - 1), false);
    assert.equal(isExpired(name, at), true);
    assert.equal(isExpired("jm-probe-garbage", 0), true, "ours but unreadable = expired");
    assert.equal(parseName("someone-elses-server").ours, false);
    assert.equal(isExpired("someone-elses-server", Infinity), false);
    assert.throws(() => makeName("BAD NAME", at));
  });
});

describe("stateless SSH identity", () => {
  const secret = "a-test-secret-that-is-long-enough-1234";
  it("is deterministic per secret and differs per secret and per purpose", () => {
    const a = deriveIdentity(secret), b = deriveIdentity(secret), c = deriveIdentity(`${secret}x`);
    assert.equal(publicLine(a.client.publicRaw), publicLine(b.client.publicRaw));
    assert.notEqual(publicLine(a.client.publicRaw), publicLine(c.client.publicRaw));
    assert.notEqual(publicLine(a.client.publicRaw), publicLine(a.host.publicRaw));
    assert.throws(() => deriveIdentity("short"));
  });
  it("produces a working ed25519 key pair", () => {
    const { client } = deriveIdentity(secret);
    const sig = sign(null, Buffer.from("m"), createPrivateKey(client.pkcs8Pem));
    assert.ok(verify(null, Buffer.from("m"), createPublicKey(createPrivateKey(client.pkcs8Pem)), sig));
  });
  const haveKeygen = spawnSync("ssh-keygen", ["-?"]).error === undefined;
  it("writes an OpenSSH private key that ssh-keygen accepts and that matches the public line", { skip: !haveKeygen && "ssh-keygen not installed" }, () => {
    const { client } = deriveIdentity(secret);
    const dir = mkdtempSync(join(tmpdir(), "jm-key-"));
    const file = join(dir, "id");
    writeFileSync(file, openSshPrivate(client, "jm"), { mode: 0o600 });
    const r = spawnSync("ssh-keygen", ["-y", "-f", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split(" ")[1], publicLine(client.publicRaw).split(" ")[1]);
  });
  it("pins the host key and builds strict ssh options", () => {
    const { host } = deriveIdentity(secret);
    assert.match(knownHostsLine("203.0.113.10", host.publicRaw), /^203\.0\.113\.10 ssh-ed25519 /);
    const args = sshArgs({ keyFile: "/k", knownHostsFile: "/h", ip: "203.0.113.10" }).join(" ");
    for (const o of ["StrictHostKeyChecking=yes", "BatchMode=yes", "PasswordAuthentication=no", "IdentitiesOnly=yes", "UserKnownHostsFile=/h"]) assert.ok(args.includes(o), o);
    assert.ok(args.endsWith("jmprobe@203.0.113.10"));
  });
  it("cloud-init: key login only, no root, no password, and never contains the secret", () => {
    const text = buildUserData({ identity: deriveIdentity(secret) });
    for (const s of ["ssh_pwauth: false", "disable_root: true", "lock_passwd: true", "ssh-ed25519 ", "BEGIN OPENSSH PRIVATE KEY"]) assert.ok(text.includes(s), s);
    assert.equal(text.includes(secret), false);
  });
});

describe("ArvanCloud client", () => {
  let mock;
  beforeEach(async () => (mock = await startMockArvan()));
  afterEach(() => mock.close());
  const client = (extra = {}) => createClient({ apiKey: mock.apiKey, base: mock.base, sleep: noSleep, ...extra });

  it("retries transient errors (500) and succeeds", async () => {
    mock.state.faults.failNext.set("GET /ecc/v1/regions", 2);
    assert.equal((await client().regions()).length, 1);
    assert.equal(mock.state.calls.filter((c) => c.path === "/ecc/v1/regions").length, 3);
  });
  it("gives up after the retry budget and does not retry client errors", async () => {
    mock.state.faults.failNext.set("GET /ecc/v1/regions", 99);
    await assert.rejects(client({ retries: 2 }).regions(), /500/);
    const bad = createClient({ apiKey: "wrong-key-0123456789", base: mock.base, sleep: noSleep });
    const before = mock.state.calls.length;
    await assert.rejects(bad.regions(), /401/);
    assert.equal(mock.state.calls.length - before, 1, "401 is not retried");
  });
  it("never puts the key into an error message and refuses plain HTTP to a remote host", async () => {
    const bad = createClient({ apiKey: mock.apiKey, base: mock.base, sleep: noSleep, fetchImpl: async () => { throw new Error(`socket error with ${mock.apiKey}`); }, retries: 0 });
    await assert.rejects(bad.regions(), (e) => !e.message.includes(mock.apiKey));
    assert.throws(() => createClient({ apiKey: mock.apiKey, base: "http://napi.example.org" }), /plain HTTP/);
  });
});

describe("sweeper (clean-up independent of the deploy run)", () => {
  let mock, c;
  beforeEach(async () => { mock = await startMockArvan(); c = createClient({ apiKey: mock.apiKey, base: mock.base, sleep: noSleep }); });
  afterEach(() => mock.close());
  const now = Date.UTC(2026, 10, 10);

  it("deletes only expired resources of ours, keeps active ones, and never touches anything else", async () => {
    mock.add("servers", makeName("aaaa1111", now - HOUR));
    mock.add("floating-ips", makeName("aaaa1111", now - HOUR, "ip"));
    mock.add("servers", makeName("bbbb2222", now + HOUR));
    mock.add("servers", "customer-production-server");
    const r = await sweep({ client: c, region: REGION, now, sleep: noSleep });
    assert.equal(r.ok, true);
    assert.equal(r.deleted.length, 2);
    assert.equal(r.active.length, 1);
    assert.deepEqual(mock.state.store.servers.map((s) => s.name).sort(), [makeName("bbbb2222", now + HOUR), "customer-production-server"].sort());
  });
  it("force removes every resource of ours (not others), servers before the rest", async () => {
    mock.add("ssh-keys", makeName("aaaa1111", now + HOUR, "key"));
    mock.add("servers", makeName("aaaa1111", now + HOUR));
    mock.add("servers", "other");
    const r = await sweep({ client: c, region: REGION, now, force: true, sleep: noSleep });
    assert.equal(r.ok, true);
    assert.equal(mock.state.store.servers.length, 1);
    const order = mock.state.calls.filter((x) => x.method === "DELETE").map((x) => x.path.split("/")[5]);
    assert.deepEqual(order, ["servers", "ssh-keys"]);
  });
  it("retries a transient delete failure and then succeeds", async () => {
    mock.add("servers", makeName("aaaa1111", now - HOUR));
    mock.state.faults.failNext.set("DELETE /ecc/v1/regions/ir-test-1/servers/servers-1", 2);
    const r = await sweep({ client: createClient({ apiKey: mock.apiKey, base: mock.base, sleep: noSleep, retries: 0 }), region: REGION, now, sleep: noSleep });
    assert.equal(r.ok, true);
    assert.ok(r.deleteErrors.length >= 1, "the failures are reported, not hidden");
  });
  it("reports NOT clean when a delete keeps failing, and says what to do by hand", async () => {
    mock.add("servers", makeName("aaaa1111", now - HOUR));
    mock.state.faults.permanentDelete.add("servers");
    const r = await sweep({ client: c, region: REGION, now, sleep: noSleep });
    assert.equal(r.ok, false);
    assert.equal(r.leftover.length, 1);
    assert.match(describeSweep(r), /NOT confirmed clean/);
    assert.match(describeSweep(r), /jm-probe-/);
  });
  it("is not clean when it cannot list a resource type: unknown is never reported as empty", async () => {
    mock.state.faults.failList.add("volumes");
    const r = await sweep({ client: c, region: REGION, now, attempts: 1, sleep: noSleep });
    assert.equal(r.ok, false);
    assert.equal(r.listErrors[0].kind, "volumes");
  });
});

describe("orchestrator", () => {
  let mock, c;
  beforeEach(async () => { mock = await startMockArvan(); c = createClient({ apiKey: mock.apiKey, base: mock.base, sleep: noSleep }); });
  afterEach(() => mock.close());
  const base = () => ({ client: c, region: REGION, apiKey: mock.apiKey, plan: PLAN, domain: "probe-test.example.org", certMode: "selfsigned", packageDir: join(PKG, "web"), runId: "run12345", sleep: noSleep, now: Date.UTC(2026, 10, 3) });

  it("dry-run is read only", async () => {
    const r = await dryRun({ client: c, region: REGION });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.equal(mock.mutations().length, 0);
  });
  it("dry-run fails clearly when the flavor cannot be identified", async () => {
    mock.state.sizes = [{ id: "x", vcpus: 4, memory: 8, disk: 100 }];
    const r = await dryRun({ client: c, region: REGION });
    assert.equal(r.ok, false);
    assert.throws(() => pickFlavor(mock.state.sizes), /exactly one/);
  });
  it("deploy creates exactly one server whose name carries the expiry, installs, and runs the self-check", async () => {
    const { remote, log } = fakeRemote();
    const r = await deploy({ ...base(), remoteFactory: () => remote });
    assert.equal(r.ok, true, r.error);
    assert.equal(mock.state.store.servers.length, 1);
    const s = mock.state.store.servers[0];
    assert.equal(parseName(s.name).expiresAtMs, Date.UTC(2026, 10, 3) + 48 * HOUR);
    assert.equal(s.request.flavor_id, "flv-1");
    assert.match(s.request.init_script, /ssh_pwauth: false/);
    assert.ok(log.commands.some((x) => /apt-get install/.test(x)) && log.commands.some((x) => /self-check\.sh/.test(x)));
    assert.equal(log.puts.length, 1);
    assert.equal(log.closed, true);
    assert.ok(r.ceilingIrr > 0);
    assert.equal(JSON.stringify(r).includes(mock.apiKey), false, "the report never contains the API key");
  });
  it("deploy refuses without the confirmation, with a bad domain, or when a probe resource already exists", async () => {
    const { remote } = fakeRemote();
    await assert.rejects(deploy({ ...base(), plan: { ...PLAN, confirm: "" }, remoteFactory: () => remote }), /confirmation/);
    await assert.rejects(deploy({ ...base(), domain: "bad domain;rm -rf", remoteFactory: () => remote }), /domain/);
    mock.add("servers", makeName("old00000", Date.now() + HOUR));
    await assert.rejects(deploy({ ...base(), remoteFactory: () => remote }), /already exists/);
    assert.equal(mock.mutations().length, 0, "nothing was created or deleted by the refused runs");
  });
  it("deploy removes the server again when a later step fails", async () => {
    const { remote } = fakeRemote({ waitReady: async () => { throw new Error("ssh never came up"); } });
    const r = await deploy({ ...base(), remoteFactory: () => remote });
    assert.equal(r.ok, false);
    assert.match(r.error, /ssh never came up/);
    assert.equal(mock.state.store.servers.length, 0);
    assert.equal(r.cleanup.ok, true);
  });
  it("deploy reports a failed clean-up honestly when the server cannot be removed", async () => {
    const { remote } = fakeRemote({ waitReady: async () => { throw new Error("nope"); } });
    mock.state.faults.permanentDelete.add("servers");
    const r = await deploy({ ...base(), remoteFactory: () => remote });
    assert.equal(r.ok, false);
    assert.equal(r.cleanup.ok, false);
    assert.equal(r.cleanup.leftover.length, 1);
  });
  it("deploy fails (and cleans up) when the server never gets an IPv4 address", async () => {
    mock.state.faults.noIp = true;
    const { remote } = fakeRemote();
    const r = await deploy({ ...base(), remoteFactory: () => remote, sleep: noSleep });
    assert.equal(r.ok, false);
    assert.match(r.error, /IPv4/);
    assert.equal(mock.state.store.servers.length, 0);
  });
  it("letsencrypt mode creates DNS records for the three names and removes them again on failure", async () => {
    const { remote } = fakeRemote({ run: async (cmd) => { if (/certbot certonly/.test(cmd)) throw new Error("acme failed"); return ""; } });
    const r = await deploy({ ...base(), certMode: "letsencrypt", dns: "arvan", remoteFactory: () => remote, resolveDns: async () => {} });
    assert.equal(r.ok, false);
    assert.equal(mock.state.dns.length, 0, "records removed after the failure");
    assert.ok(mock.state.calls.some((x) => x.method === "POST" && x.path.includes("dns-records")));
    assert.equal(mock.state.store.servers.length, 0);
  });
  it("collect reads the report log with the derived identity (no stored key) and summarises it", async () => {
    mock.add("servers", makeName("run12345", Date.now() + HOUR)).addresses = { public: [{ addr: "203.0.113.10" }] };
    const seen = [];
    const { remote } = fakeRemote();
    const out = mkdtempSync(join(tmpdir(), "jm-out-"));
    const r = await collect({ client: c, region: REGION, apiKey: mock.apiKey, remoteFactory: (a) => { seen.push(a); return remote; }, outDir: out });
    assert.equal(r.ok, true);
    assert.equal(r.results, 1);
    assert.match(readFileSync(join(out, "summary.txt"), "utf8"), /INSUFFICIENT DATA/);
    const again = deriveIdentity(mock.apiKey);
    assert.equal(publicLine(seen[0].identity.client.publicRaw), publicLine(again.client.publicRaw), "day-N runs get the same key");
  });
  it("destroy forces removal of everything of ours, including leftovers, and reports an estimate", async () => {
    mock.add("servers", makeName("run12345", Date.now() + HOUR));
    mock.add("volumes", makeName("run12345", Date.now() + HOUR, "vol"));
    mock.add("servers", "not-ours");
    const r = await destroy({ client: c, region: REGION, plan: PLAN, sleep: noSleep });
    assert.equal(r.ok, true);
    assert.deepEqual(mock.state.store.servers.map((s) => s.name), ["not-ours"]);
    assert.equal(mock.state.store.volumes.length, 0);
  });
});

describe("cli", () => {
  let mock;
  beforeEach(async () => (mock = await startMockArvan()));
  afterEach(() => mock.close());
  const env = (extra = {}) => ({ PROBE_OUT_DIR: mkdtempSync(join(tmpdir(), "jm-cli-")), PROBE_REGION: REGION, ...extra });

  it("does nothing and succeeds when no secret is configured (so the scheduled sweeper is harmless before setup)", async () => {
    const e = env({ PROBE_ACTION: "sweep" });
    assert.equal(await main(e), 0);
    assert.equal(JSON.parse(readFileSync(join(e.PROBE_OUT_DIR, "report.json"), "utf8")).skipped.includes("no ARVAN_API_KEY"), true);
    assert.equal(mock.state.calls.length, 0);
  });
  it("sweep exits 0 when clean and 1 when something is left over", async () => {
    const e = env({ PROBE_ACTION: "sweep", ARVAN_API_KEY: mock.apiKey, ARVAN_API_BASE: mock.base });
    assert.equal(await main(e, { sleep: noSleep }), 0);
    mock.add("servers", makeName("old00000", Date.now() - HOUR));
    mock.state.faults.permanentDelete.add("servers");
    assert.equal(await main(e, { sleep: noSleep }), 1);
  });
  it("sweeps every region when none is given (the sweeper needs no setting from the owner)", async () => {
    mock.state.regions = [{ code: "ir-test-1" }, { code: "ir-test-2" }];
    mock.add("servers", makeName("old00000", Date.now() - HOUR));
    const e = env({ PROBE_ACTION: "sweep", PROBE_REGION: "", ARVAN_API_KEY: mock.apiKey, ARVAN_API_BASE: mock.base });
    assert.equal(await main(e, { sleep: noSleep }), 0);
    const regionsSeen = new Set(mock.state.calls.map((x) => /regions\/([^/]+)\//.exec(x.path)?.[1]).filter(Boolean));
    assert.deepEqual([...regionsSeen].sort(), ["ir-test-1", "ir-test-2"]);
    assert.equal(mock.state.store.servers.length, 0);
  });
  it("dry-run through the cli makes no mutating call; invalid deploy input exits 2 and creates nothing", async () => {
    const e = env({ PROBE_ACTION: "dry-run", ARVAN_API_KEY: mock.apiKey, ARVAN_API_BASE: mock.base });
    assert.equal(await main(e), 0);
    assert.equal(mock.mutations().length, 0);
    const bad = env({ PROBE_ACTION: "deploy", ARVAN_API_KEY: mock.apiKey, ARVAN_API_BASE: mock.base, PROBE_DOMAIN: "x.example.org", PROBE_HOURLY_RATE_IRR: "13860", PROBE_MAX_HOURS: "48", PROBE_CONFIRM: "no" });
    assert.equal(await main(bad), 2);
    assert.equal(mock.mutations().length, 0);
  });
  it("never writes the API key into the report or the step summary", async () => {
    const e = env({ PROBE_ACTION: "dry-run", ARVAN_API_KEY: mock.apiKey, ARVAN_API_BASE: mock.base, GITHUB_STEP_SUMMARY: join(tmpdir(), `jm-summary-${process.pid}`) });
    await main(e);
    assert.equal(readFileSync(join(e.PROBE_OUT_DIR, "report.json"), "utf8").includes(mock.apiKey), false);
    assert.equal(readFileSync(e.GITHUB_STEP_SUMMARY, "utf8").includes(mock.apiKey), false);
  });
  it("runs as a real process too (exit code, no key echo)", () => {
    const r = spawnSync("node", [join(PKG, "automation/cli.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH, PROBE_ACTION: "sweep", PROBE_OUT_DIR: mkdtempSync(join(tmpdir(), "jm-proc-")) } });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /SKIPPED/);
  });
});

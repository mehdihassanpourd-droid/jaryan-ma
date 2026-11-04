// Regression tests for the first real dry-run, which failed with HTTP 401 on every request:
//  - the key is cleaned (pasted newline, quotes, an included "Apikey" word) and the header form is DETECTED, not guessed
//  - 401 (key not recognised) is told apart from 403 (recognised, role too weak) and from a network failure
//  - when authentication fails nothing else is called (the log showed /regions//servers with an empty region)
//  - the key and the Authorization header never reach logs, reports or error messages
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { createClient, keyShape, normalizeKey } from "../automation/lib/arvan.mjs";
import { dryRun } from "../automation/lib/orchestrator.mjs";
import { main } from "../automation/cli.mjs";
import { startMockArvan } from "../automation/mock-arvan.mjs";

const KEY = "0f3a9c1e-77b2-4d3e-9a51-6c2d8e4b1a90";
const noSleep = async () => {};
let mock;
afterEach(() => mock?.close());
const client = (extra = {}) => createClient({ apiKey: mock.apiKey, base: mock.base, sleep: noSleep, ...extra });
const paths = () => mock.state.calls.map((c) => c.path);

describe("key normalisation", () => {
  it("cleans a pasted newline, quotes and an included Apikey word, and says what it did without the value", () => {
    assert.equal(normalizeKey(`${KEY}\n`).key, KEY);
    assert.equal(normalizeKey(`"${KEY}"`).key, KEY);
    assert.equal(normalizeKey(`Apikey ${KEY}`).key, KEY);
    assert.equal(normalizeKey(`  apikey   ${KEY} \r\n`).key, KEY);
    assert.equal(normalizeKey(`Bearer ${KEY}`).key, KEY);
    const n = normalizeKey(`"Apikey ${KEY}"\n`).notes.join(" ");
    assert.ok(n.includes("quotes") && n.includes("Apikey") && !n.includes(KEY));
    assert.deepEqual(normalizeKey(KEY).notes, []);
  });
  it("refuses a value with spaces or control characters inside, with a message that does not repeat it", () => {
    for (const bad of [`${KEY} extra`, `${KEY}\nsecond-line`, "", "   ", `ke\u0000y${KEY}`]) {
      assert.throws(() => normalizeKey(bad), (e) => !e.message.includes(KEY) && !e.message.includes("extra"));
    }
  });
  it("describes the shape without revealing the key", () => {
    assert.deepEqual(keyShape(KEY), { length: 36, uuidLike: true });
    assert.equal(keyShape("short").uuidLike, false);
  });
});

describe("authentication detection", () => {
  it("finds the header form the server wants (bare key) and keeps using it", async () => {
    mock = await startMockArvan({ authFormat: (k) => k });
    const c = client();
    const r = await dryRun({ client: c, region: "ir-test-1" });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.equal(r.auth.scheme, "bare");
    assert.equal(c.scheme(), "bare");
    assert.equal(mock.state.calls.at(-1).auth, mock.apiKey, "later calls use the detected form");
  });
  it("finds APIKEY in capitals as well", async () => {
    mock = await startMockArvan({ authFormat: (k) => `APIKEY ${k}` });
    const r = await dryRun({ client: client(), region: "ir-test-1" });
    assert.equal(r.auth.scheme, "APIKEY");
  });
  it("works when the secret was pasted with a trailing newline and the word Apikey in front", async () => {
    mock = await startMockArvan();
    const c = createClient({ apiKey: `Apikey ${mock.apiKey}\n`, base: mock.base, sleep: noSleep });
    const r = await dryRun({ client: c, region: "ir-test-1" });
    assert.equal(r.ok, true);
    assert.ok(r.auth.keyNotes.length >= 2, "the cleaning is reported");
    assert.equal(mock.state.calls[0].auth, `Apikey ${mock.apiKey}`, "the header carries the clean key, not 'Apikey Apikey ...'");
  });
  it("401 everywhere: reports 'key not recognised' (not a role problem), tries only GET /regions, and stops", async () => {
    mock = await startMockArvan();
    const c = createClient({ apiKey: "another-key-that-is-wrong-123456", base: mock.base, sleep: noSleep });
    const r = await dryRun({ client: c, region: "ir-test-1" });
    assert.equal(r.ok, false);
    assert.equal(r.auth.diagnosis, "unauthorized");
    assert.deepEqual(r.auth.tried.map((t) => t.status), [401, 401, 401, 401, 401]);
    assert.match(r.checks[0].detail, /does not recognise the key/);
    assert.match(r.checks[0].detail, /403/);
    assert.deepEqual([...new Set(paths())], ["/ecc/v1/regions"], "no dependent request, and no request with an empty region");
    assert.equal(paths().some((p) => p.includes("regions//")), false);
    assert.equal(mock.mutations().length, 0);
  });
  it("403: says the key is recognised but its role is too weak, and that nothing is changed automatically", async () => {
    mock = await startMockArvan();
    mock.state.faults.forbidAll = true;
    const r = await dryRun({ client: client(), region: "ir-test-1" });
    assert.equal(r.ok, false);
    assert.equal(r.auth.diagnosis, "forbidden");
    assert.match(r.checks[0].detail, /recognised/);
    assert.match(r.checks[0].detail, /never changes permissions/);
  });
  it("no answer at all is reported as a network problem, not as a bad key", async () => {
    mock = await startMockArvan();
    const c = client({ fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); } });
    const r = await dryRun({ client: c, region: "ir-test-1" });
    assert.equal(r.auth.diagnosis, "unreachable");
    assert.match(r.checks[0].detail, /network or DNS problem/);
  });
});

describe("region handling", () => {
  it("uses the only region when none is given, and never calls a path with an empty region", async () => {
    mock = await startMockArvan();
    const r = await dryRun({ client: client(), region: "" });
    assert.equal(r.ok, true, JSON.stringify(r.checks));
    assert.equal(r.region, "ir-test-1");
    assert.equal(paths().some((p) => p.includes("regions//")), false);
  });
  it("with several regions it asks for a choice and lists them, without guessing", async () => {
    mock = await startMockArvan();
    mock.state.regions = [{ code: "ir-a" }, { code: "ir-b" }];
    const r = await dryRun({ client: client(), region: "" });
    assert.equal(r.ok, false);
    assert.match(r.checks.at(-1).detail, /ir-a, ir-b/);
    assert.equal(paths().every((p) => p === "/ecc/v1/regions"), true);
  });
});

describe("secrets stay out of every output", () => {
  it("the call log, the report and the step summary never contain the key or an Authorization header", async () => {
    mock = await startMockArvan();
    const dir = mkdtempSync(join(tmpdir(), "jm-auth-"));
    const summary = join(dir, "summary.md");
    const env = { PROBE_ACTION: "dry-run", PROBE_OUT_DIR: dir, PROBE_REGION: "ir-test-1", ARVAN_API_KEY: `${mock.apiKey}\n`, ARVAN_API_BASE: mock.base, GITHUB_STEP_SUMMARY: summary };
    assert.equal(await main(env), 0);
    const text = readFileSync(join(dir, "report.json"), "utf8") + readFileSync(summary, "utf8");
    assert.equal(text.includes(mock.apiKey), false);
    assert.equal(/authorization|apikey\s+\S{8,}/i.test(text), false);
  });
  it("a failed login through the cli exits 1, explains the 401, and still leaks nothing", async () => {
    mock = await startMockArvan();
    const dir = mkdtempSync(join(tmpdir(), "jm-auth-"));
    const wrong = "the-wrong-key-0123456789abcdef";
    const env = { PROBE_ACTION: "dry-run", PROBE_OUT_DIR: dir, ARVAN_API_KEY: wrong, ARVAN_API_BASE: mock.base };
    assert.equal(await main(env), 1);
    const report = readFileSync(join(dir, "report.json"), "utf8");
    assert.equal(report.includes(wrong), false);
    assert.match(report, /does not recognise the key/);
  });
  it("every other action fails loudly on a bad key and sends no delete or create", async () => {
    mock = await startMockArvan();
    for (const action of ["sweep", "destroy", "collect"]) {
      const env = { PROBE_ACTION: action, PROBE_OUT_DIR: mkdtempSync(join(tmpdir(), "jm-auth-")), PROBE_REGION: "ir-test-1", ARVAN_API_KEY: "the-wrong-key-0123456789abcdef", ARVAN_API_BASE: mock.base };
      assert.equal(await main(env), 1, action);
    }
    assert.equal(mock.mutations().length, 0);
  });
  it("client errors for a rejected request do not contain the key even when the server echoes it", async () => {
    mock = await startMockArvan();
    const c = client({ fetchImpl: async () => new Response(JSON.stringify({ message: `bad token ${mock.apiKey}` }), { status: 400 }) });
    await assert.rejects(c.regions(), (e) => !e.message.includes(mock.apiKey) && e.message.includes("[redacted]"));
  });
});

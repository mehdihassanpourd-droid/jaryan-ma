import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { DOMAIN, PKG, haveNginx, haveOpenssl, startProbe } from "./helpers.mjs";

const have = spawnSync("curl", ["--version"]).status === 0;
describe("scripts/self-check.sh against a local probe", { skip: !haveNginx || !haveOpenssl || !have ? "needs nginx, openssl and curl" : false }, () => {
  let probe;
  before(async () => (probe = await startProbe()));
  after(async () => probe?.stop());
  it("passes every check", () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/proxy/i.test(k)));
    const r = spawnSync("bash", [`${PKG}/scripts/self-check.sh`, "--domain", DOMAIN, "--port", String(probe.httpsPort), "--ip", "127.0.0.1", "--insecure"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /ALL CHECKS PASSED/);
  });
  it("rejects a bad domain argument", () => {
    assert.equal(spawnSync("bash", [`${PKG}/scripts/self-check.sh`, "--domain", "a b; rm"]).status, 64);
  });
});

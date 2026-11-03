// Real-browser test: the tester page runs against the real nginx probe over HTTPS (self-signed certificate, names mapped to 127.0.0.1).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { HOSTS, haveNginx, haveOpenssl, startProbe } from "./helpers.mjs";

let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch {
  /* Playwright is optional: the browser tests are skipped without it */
}
const skip = !haveNginx || !haveOpenssl || !chromium ? "needs nginx, openssl and playwright" : false;

describe("tester page in a real browser", { skip }, () => {
  let probe, browser;
  const url = () => `https://${HOSTS.page}:${probe.httpsPort}/`;
  const newContext = (extra = {}) =>
    browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 412, height: 915 }, locale: "fa-IR", ...extra });

  before(async () => {
    probe = await startProbe();
    // the browser must not inherit a proxy from the environment: the test names are mapped straight to 127.0.0.1
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/proxy/i.test(key)));
    browser = await chromium.launch({ env, args: ["--host-resolver-rules=MAP *.jm.test 127.0.0.1", "--no-sandbox"] });
  });
  after(async () => {
    await browser?.close();
    await probe?.stop();
  });

  async function run(page) {
    await page.goto(url());
    await page.selectOption("#operator", "fixed");
    await page.selectOption("#network", "wifi");
    await page.selectOption("#vpn", "off");
    await page.fill("#tester", "T1");
    await page.click("#start");
    await page.waitForFunction(() => document.querySelector("#json")?.value.length > 20, null, { timeout: 30000 });
    return JSON.parse(await page.inputValue("#json"));
  }

  it("passes every step, including the cross-origin API, cookie, large POST and the payment round trip", async () => {
    const context = await newContext();
    const page = await context.newPage();
    const external = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!u.hostname.endsWith(".jm.test") && u.protocol.startsWith("http")) external.push(r.url());
    });
    const result = await run(page);
    assert.equal(result.verdict, "pass", JSON.stringify(result.steps));
    for (const s of result.steps) assert.equal(s.ok, true, `${s.id}: ${s.err}`);
    assert.deepEqual(result.steps.map((s) => s.id).sort(), ["apiCatalog", "apiPing", "cart", "catalog", "image", "ip", "order", "page", "payment", "session", "stability"].sort());
    assert.deepEqual(external, [], "the page talks to the probe hosts only");
    assert.equal(result.meta.tester, "T1");
    assert.equal(JSON.stringify(result).includes("127.0.0.1"), false, "the result holds no address");
    // the cookie really was set for the API host with the right attributes
    const cookie = (await context.cookies()).find((c) => c.name === "jm_probe_sid");
    assert.ok(cookie, "session cookie stored");
    assert.equal(cookie.domain.replace(/^\./, ""), HOSTS.api);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.sameSite, "Lax");
    // the result was also delivered to the server's report log, without any address
    await page.click("#send");
    await page.waitForFunction(() => /ارسال شد|✔/.test(document.querySelector("#sendStatus").textContent), null, { timeout: 10000 }).catch(() => {});
    const line = probe.reportLog().trim().split("\n").pop() ?? "";
    assert.match(line, /^\d{4}-\d\d-\d\dT[\d:+]+ [A-Za-z0-9_-]{20,}$/);
    assert.equal(JSON.parse(Buffer.from(line.split(" ")[1], "base64url").toString()).verdict, "pass");
    await context.close();
  });

  it("reports a failure (not a pass) when the API host is unreachable", async () => {
    const context = await newContext();
    const page = await context.newPage();
    await page.route(`https://${HOSTS.api}:*/**`, (route) => route.abort());
    const result = await run(page);
    assert.notEqual(result.verdict, "pass");
    assert.equal(result.steps.find((s) => s.id === "apiPing").ok, false);
    assert.equal(result.steps.find((s) => s.id === "image").ok, true, "browsing still works");
    await context.close();
  });

  it("fits a 412 px phone without horizontal scrolling", async () => {
    const context = await newContext();
    const page = await context.newPage();
    await page.goto(url());
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
    assert.equal(await page.getAttribute("html", "dir"), "rtl");
    await context.close();
  });
});

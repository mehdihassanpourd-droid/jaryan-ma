// Static safety checks on the package itself (no nginx needed) plus independence from the Jaryan Ma application.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { makeCatalog, makePng } from "../scripts/make-assets.mjs";
import { PKG } from "./helpers.mjs";

const template = readFileSync(join(PKG, "nginx/probe.conf.template"), "utf8");
const code = template.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(PKG).map((f) => relative(PKG, f));
const text = (f) => readFileSync(join(PKG, f), "utf8");

describe("nginx template is a closed, privacy-preserving design", () => {
  it("has no directive that could forward traffic (cannot be an open proxy)", () => {
    for (const d of ["proxy_pass", "fastcgi_pass", "uwsgi_pass", "scgi_pass", "grpc_pass", "upstream", "resolver", "stream ", "perl", "lua", "js_content", "mirror"]) {
      assert.equal(code.includes(d), false, `forbidden directive: ${d}`);
    }
  });
  it("never logs the raw client address, user agent, referer, cookie or query string", () => {
    const formats = code.match(/log_format[^;]+;/g) ?? [];
    assert.ok(formats.length >= 2);
    for (const f of formats) for (const v of ["$remote_addr", "$http_x_forwarded_for", "$http_user_agent", "$http_referer", "$http_cookie", "$request ", "$request_uri", "$args", "$query_string", "$binary_remote_addr", "$proxy_protocol_addr", "$realip_remote_addr"]) assert.equal(f.includes(v), false, `${v} in ${f.slice(0, 40)}`);
  });
  it("trusts no forwarded address header (no real_ip module settings)", () => {
    assert.equal(/set_real_ip_from|real_ip_header/.test(code), false);
  });
  it("never allows every origin and never reflects the Origin header", () => {
    assert.equal(/Access-Control-Allow-Origin\s+"?\*/.test(code), false);
    assert.equal(code.includes("$http_origin"), false);
  });
  it("sets size limits, timeouts and rate limits", () => {
    for (const d of ["client_max_body_size", "limit_req_zone", "limit_req ", "limit_conn", "keepalive_timeout", "large_client_header_buffers"]) assert.ok(code.includes(d), d);
  });
  it("does not enable directory listings or server version disclosure", () => {
    assert.equal(/autoindex\s+on/.test(code), false);
    assert.equal(code.includes("server_tokens on"), false);
  });
  it("rate limits never sit on a location that answers with a bare return (nginx runs return first)", () => {
    for (const m of code.matchAll(/location\s+[^{]+\{([^{}]*)\}/g)) {
      const body = m[1];
      if (/limit_req /.test(body)) assert.equal(/\n\s*return\s+\d+/.test(body.replace(/if\s*\([^)]*\)\s*\{[^}]*\}/g, "")), false, `limit_req + return in: ${body.slice(0, 80)}`);
    }
  });
});

describe("package is independent of the Jaryan Ma application", () => {
  it("imports nothing from the application or its dependencies", () => {
    for (const f of files.filter((x) => /\.(mjs|js|sh)$/.test(x) && x !== "test/config.test.mjs")) {
      const t = text(f);
      assert.equal(/from\s+["'](\.\.\/){3,}|require\(["'](\.\.\/){3,}/.test(t), false, `${f} reaches outside the package`);
      assert.equal(/@prisma|from\s+["']@\/|src\/|server\/|\bprisma\b/.test(t.replace(/\/\/.*$/gm, "")), false, `${f} mentions application code`);
    }
  });
  it("has no secrets, real addresses, e-mail addresses or external URLs in the page", () => {
    for (const f of ["web/index.html", "web/probe.js", "web/probe.css"]) {
      const t = text(f);
      assert.equal(/https?:\/\/(?!\$)/.test(t.replace(/http:\/\/www\.w3\.org[^"']*/g, "")), false, `${f} has an absolute URL`);
      assert.equal(/@[a-z0-9-]+\.[a-z]{2,}/i.test(t), false, `${f} has an e-mail address`);
    }
    for (const f of files) assert.equal(/BEGIN (RSA |EC )?PRIVATE KEY/.test(text(f).slice(0, 200000)), false, f);
  });
  it("has no dependency manifest (nothing to install, nothing paid)", () => {
    assert.equal(files.includes("package.json"), false);
  });
  it("committed test assets are exactly what the generator produces", () => {
    assert.ok(readFileSync(join(PKG, "web/img/product.png")).equals(makePng()));
    assert.equal(text("web/data/catalog.json"), makeCatalog());
  });
  it("the test page asks for no personal data", () => {
    const html = text("web/index.html");
    for (const bad of ["type=\"tel\"", "type=\"email\"", "type=\"password\"", "name=\"phone\"", "cc-number", "autocomplete=\"name\"", "autocomplete=\"address"]) assert.equal(html.toLowerCase().includes(bad), false, bad);
    assert.ok([...html.matchAll(/<input[^>]*>/g)].every((m) => /type="text"/.test(m[0]) && /maxlength=/.test(m[0])), "every input is short plain text");
  });
});

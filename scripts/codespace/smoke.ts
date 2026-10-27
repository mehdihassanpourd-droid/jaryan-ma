// Verifies the Codespaces test environment end to end WITHOUT a Codespace (used by CI and for local checks):
// the real scripts start the real server in the background on a simulated private https origin, the first
// administrator is created through the real first-run flow (password + mandatory TOTP), and the checks talk to the
// server over HTTP with that Origin. Everything runs against a real PostgreSQL 16.
//   export JARYAN_STATE_DIR=<throw-away dir>; npm run codespace:setup; npx tsx scripts/codespace/smoke.ts
import { spawn, execFileSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { totpAt, totpStep } from "../../server/auth/totp";
import { solidPng } from "../../admin/e2e/png";

const ROOT = join(import.meta.dirname, "../..");
const ORIGIN = "https://smoke-3001.app.github.dev";
const PORT = Number(process.env.PORT ?? 3001);
const BASE = `http://127.0.0.1:${PORT}`;
// Required (never a default): this script deletes its state directory afterwards, so it must never point at a real Codespace's data.
const stateDir = process.env.JARYAN_STATE_DIR;
if (!stateDir) {
  console.error("Set JARYAN_STATE_DIR to a throw-away directory, and run `npm run codespace:setup` with the same value first.");
  process.exit(2);
}
const state: string = stateDir;
const env = { ...process.env, JARYAN_STATE_DIR: state, JARYAN_PUBLIC_ORIGIN: ORIGIN, PORT: String(PORT) };
const EMAIL = "smoke@example.test";
const PASSWORD = "rain-over-the-woven-hills-92";
const PG_BIN = process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin";

const results: string[] = [];
let failed = false;
const check = (name: string, pass: boolean, detail = "") => {
  results.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!pass) failed = true;
};

function run(script: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [join(ROOT, "scripts/codespace", script), ...args], { env, cwd: ROOT });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

/** Drives the interactive admin CLI like a person would: password twice, then the TOTP code for the printed secret. */
function createAdminWithCli(email: string, role: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [join(ROOT, "scripts/codespace/create-admin.sh"), email, role], { env, cwd: ROOT });
    let out = "";
    let stage = 0;
    const step = () => {
      if (stage === 0 && out.includes("New password")) { child.stdin.write(`${PASSWORD}\n`); stage = 1; }
      if (stage === 1 && out.includes("Repeat password")) { child.stdin.write(`${PASSWORD}\n`); stage = 2; }
      const m = /Secret\s*:\s*([A-Z2-7]+)/.exec(out);
      if (stage === 2 && m && out.includes("6-digit code")) {
        child.stdin.write(`${totpAt(m[1] as string, totpStep(Date.now()))}\n`);
        stage = 3;
      }
    };
    const onData = (d: Buffer) => { out += d.toString(); step(); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}/api/v1${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** A request as GitHub's forwarder delivers it: TLS ended upstream, the EXTERNAL host in Host, the browser's Origin untouched. */
function forwardedPost(path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const r = httpRequest({ host: "127.0.0.1", port: PORT, path: `/api/v1${path}`, method: "POST", headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...headers } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, json: data ? JSON.parse(data) : null }));
    });
    r.on("error", reject);
    r.end(text);
  });
}

async function main() {
  // 1. the app starts by itself (no terminal, no administrator yet) and the bare address is not a 404
  const up = await run("up.sh", []);
  try {
    check("up.sh starts the app in the background and prints the private URL", up.code === 0 && up.out.includes(`${ORIGIN}/admin/`), `exit ${up.code}`);
    const root = await fetch(`${BASE}/`, { redirect: "manual" });
    check("the bare address redirects to /admin/ (no 404)", root.status === 302 && root.headers.get("location") === "/admin/");
    const shell = await fetch(`${BASE}/admin/`);
    const csp = shell.headers.get("content-security-policy") ?? "";
    check("/admin/ is served with strict CSP (no unsafe-inline/eval) and the private media origin", shell.ok && !/unsafe-(inline|eval)/.test(csp) && csp.includes(ORIGIN));
    check("anonymous API access is refused", (await fetch(`${BASE}/api/v1/products`)).status === 401);
    check("state directory is private (700) and DB password file is 600", (statSync(state).mode & 0o777) === 0o700 && (statSync(join(state, "db.pass")).mode & 0o777) === 0o600);

    // 2. first-run setup in the browser flow: same rules as the CLI, TOTP proven before anything is stored
    const open = (await (await fetch(`${BASE}/api/v1/setup/status`)).json()) as { open: boolean };
    check("first-run setup is open while there is no administrator", open.open === true);
    // The browser's Origin is the external host it addressed; it must be accepted even if it differs from the computed
    // ADMIN_ORIGINS (the Codespaces failure), and a page on any other site, or another Codespace, must still be refused.
    const external = "renamed-3001.app.github.dev";
    const viaForwarder = await forwardedPost("/setup/begin", { email: EMAIL, password: PASSWORD }, { host: external, origin: `https://${external}` });
    check("same-origin forwarded HTTPS host is accepted even when it differs from ADMIN_ORIGINS", viaForwarder.status === 200, `status ${viaForwarder.status}`);
    const evil = await forwardedPost("/setup/begin", { email: EMAIL, password: PASSWORD }, { host: external, origin: "https://evil.example" });
    check("a foreign site's Origin is refused and explained (development)", evil.status === 403 && evil.json?.error === "bad_origin" && evil.json?.detail?.receivedOrigin === "https://evil.example");
    const otherCodespace = await forwardedPost("/setup/begin", { email: EMAIL, password: PASSWORD }, { host: external, origin: "https://attacker-3001.app.github.dev" });
    check("another Codespace's Origin is refused", otherCodespace.status === 403);
    check("a missing Origin is refused", (await forwardedPost("/setup/begin", { email: EMAIL, password: PASSWORD }, { host: external })).status === 403);
    check("a weak password is refused", (await post("/setup/begin", { email: EMAIL, password: "short" })).status === 422);
    check("setup from a foreign Origin is refused", (await fetch(`${BASE}/api/v1/setup/begin`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) })).status === 403);
    const begun = (await (await post("/setup/begin", { email: EMAIL, password: PASSWORD })).json()) as { token: string; secret: string; otpauthUri: string };
    check("setup hands out a TOTP secret and otpauth link", /^[A-Z2-7]{20,}$/.test(begun.secret) && begun.otpauthUri.startsWith("otpauth://totp/"));
    check("a wrong TOTP code does not create the account", (await post("/setup/finish", { token: begun.token, code: "000000" })).status === 401);
    const finished = await post("/setup/finish", { token: begun.token, code: totpAt(begun.secret, totpStep(Date.now())) });
    check("the correct TOTP code creates the owner", finished.status === 201);
    const closed = (await (await fetch(`${BASE}/api/v1/setup/status`)).json()) as { open: boolean };
    check("setup closes for good after the first account", closed.open === false && (await post("/setup/begin", { email: "again@example.test", password: PASSWORD })).status === 403);

    // 3. real sign-in with password + TOTP
    const noTotp = await post("/auth/login", { email: EMAIL, password: PASSWORD });
    check("correct password without TOTP is refused (no cookie)", noTotp.status === 401 && !noTotp.headers.get("set-cookie"));
    check("wrong TOTP is refused", (await post("/auth/login", { email: EMAIL, password: PASSWORD, totp: "000000" })).status === 401);
    let login: Response | null = null;
    for (const offset of [1, 0, -1]) { // the setup step used the current code once; a neighbouring step is accepted
      login = await post("/auth/login", { email: EMAIL, password: PASSWORD, totp: totpAt(begun.secret, totpStep(Date.now()) + offset) });
      if (login.status === 200) break;
    }
    const session = (await login!.json()) as { csrfToken: string; role: string; permissions: string[] };
    const setCookie = login!.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    check("login with password + TOTP succeeds", login!.status === 200 && session.role === "owner" && session.permissions.includes("product:publish"));
    check("session cookie is __Host-, Secure, HttpOnly, SameSite=Strict", /^__Host-jm_session=/.test(setCookie) && /secure/i.test(setCookie) && /httponly/i.test(setCookie) && /samesite=strict/i.test(setCookie));

    const authed = { cookie, "x-csrf-token": session.csrfToken };
    check("mutation without CSRF token is refused", (await post("/products", { name: "x" }, { cookie })).status === 403);
    const created = await post("/products", { name: "محصول آزمایشی", status: "draft", fulfillment: "unique", inventory: 1, priceToman: 999999999999999 }, authed);
    const product = (await created.json()) as { product: { id: string; priceToman: number } };
    check("product creation works; a 15-digit price is exact", created.status === 201 && product.product.priceToman === 999999999999999);
    const upload = await fetch(`${BASE}/api/v1/products/${product.product.id}/images`, { method: "POST", headers: { origin: ORIGIN, "content-type": "image/png", ...authed }, body: new Uint8Array(solidPng(30, 40, [120, 140, 90])) });
    const image = (await upload.json()) as { key: string };
    check("image upload stores and serves media on the same origin", upload.status === 201 && (await fetch(`${BASE}/media/${image.key}`)).status === 200);

    // 4. the command-line path still works next to the browser flow (second account, read-only role)
    const cli = await createAdminWithCli("viewer@example.test", "viewer");
    check("the CLI can still add an account with TOTP", cli.code === 0 && cli.out.includes("with two-factor authentication"), `exit ${cli.code}`);

    // 5. the data really is in the private PostgreSQL 16
    const count = execFileSync(join(PG_BIN, "psql"), ["-h", "127.0.0.1", "-p", process.env.JARYAN_PG_PORT ?? "5433", "-U", "jaryan", "-d", "jaryan", "-tAc", "SELECT (SELECT count(*) FROM products) || ' ' || (SELECT count(*) FROM admin_users) || ' ' || current_setting('server_version_num')::int/10000"], { env: { ...process.env, PGPASSWORD: execFileSync("cat", [join(state, "db.pass")]).toString().trim() } }).toString().trim();
    check("data is in PostgreSQL 16 (1 product, 2 admins)", count === "1 2 16", count);
  } finally {
    const down = await run("down.sh", []);
    check("down.sh stops the background app", down.code === 0 && (await fetch(`${BASE}/healthz`).then(() => false, () => true)), `exit ${down.code}`);
    try { execFileSync(join(PG_BIN, "pg_ctl"), ["-D", join(state, "pg"), "stop", "-m", "fast"], { stdio: "ignore" }); } catch { /* not running */ }
  }
}

main()
  .catch((e) => { failed = true; results.push(`FAIL  harness error: ${e instanceof Error ? e.message : String(e)}`); })
  .finally(() => {
    console.log(results.join("\n"));
    if (!process.env.JARYAN_KEEP_STATE) rmSync(state, { recursive: true, force: true });
    console.log(failed ? "\nRESULT: FAILURES" : "\nRESULT: ALL PASS");
    process.exit(failed ? 1 : 0);
  });

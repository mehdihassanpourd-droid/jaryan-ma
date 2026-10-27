// Verifies the Codespaces test environment end to end WITHOUT a Codespace (used by CI and for local checks):
// the real scripts create a real administrator (password + TOTP) in a real PostgreSQL 16, start the real server on a
// simulated private https origin, and the checks below talk to it over HTTP with that Origin.
//   JARYAN_STATE_DIR=<empty dir> npx tsx scripts/codespace/smoke.ts
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { totpAt, totpStep } from "../../server/auth/totp";
import { solidPng } from "../../admin/e2e/png";

const ROOT = join(import.meta.dirname, "../..");
const ORIGIN = "https://smoke-3001.app.github.dev";
const PORT = Number(process.env.PORT ?? 3001);
const BASE = `http://127.0.0.1:${PORT}`;
const state = process.env.JARYAN_STATE_DIR ?? mkdtempSync(join(tmpdir(), "jm-codespace-"));
const env = { ...process.env, JARYAN_STATE_DIR: state, JARYAN_PUBLIC_ORIGIN: ORIGIN, PORT: String(PORT) };
const EMAIL = "smoke@example.test";
const PASSWORD = "rain-over-the-woven-hills-92";

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
function createAdmin(): Promise<{ code: number; out: string; secret: string }> {
  return new Promise((resolve) => {
    const child = spawn("bash", [join(ROOT, "scripts/codespace/create-admin.sh"), EMAIL, "owner"], { env, cwd: ROOT });
    let out = "";
    let secret = "";
    let stage = 0;
    const step = () => {
      if (stage === 0 && out.includes("New password")) { child.stdin.write(`${PASSWORD}\n`); stage = 1; }
      if (stage === 1 && out.includes("Repeat password")) { child.stdin.write(`${PASSWORD}\n`); stage = 2; }
      const m = /Secret\s*:\s*([A-Z2-7]+)/.exec(out);
      if (stage === 2 && m && out.includes("6-digit code")) {
        secret = m[1] as string;
        child.stdin.write(`${totpAt(secret, totpStep(Date.now()))}\n`);
        stage = 3;
      }
    };
    const onData = (d: Buffer) => { out += d.toString(); step(); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("close", (code) => resolve({ code: code ?? 1, out, secret }));
  });
}

async function waitUp(child: ChildProcess): Promise<void> {
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error("server exited early");
    try { if ((await fetch(`${BASE}/admin/`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start");
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${BASE}/api/v1${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function main() {
  // 1. nothing works without an administrator who has TOTP
  const early = await run("start.sh", []);
  check("start refuses while no administrator with TOTP exists", early.code !== 0 && early.out.includes("codespace:admin"), `exit ${early.code}`);

  // 2. create the administrator through the real script
  const created = await createAdmin();
  check("create-admin creates an owner with TOTP", created.code === 0 && created.out.includes("with two-factor authentication") && created.secret.length > 10, `exit ${created.code}`);
  check("state directory is private (700) and DB password file is 600", (statSync(state).mode & 0o777) === 0o700 && (statSync(join(state, "db.pass")).mode & 0o777) === 0o600);

  // 3. start the server on the simulated private origin
  const server = spawn("bash", [join(ROOT, "scripts/codespace/start.sh")], { env, cwd: ROOT, detached: true });
  let log = "";
  server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
  server.stderr?.on("data", (d: Buffer) => (log += d.toString()));
  try {
    await waitUp(server);
    check("start prints the private admin URL", log.includes(`${ORIGIN}/admin/`));

    const shell = await fetch(`${BASE}/admin/`);
    const csp = shell.headers.get("content-security-policy") ?? "";
    check("/admin/ served with strict CSP (no unsafe-inline/eval) and the private media origin", shell.ok && !/unsafe-(inline|eval)/.test(csp) && csp.includes(ORIGIN));
    check("anonymous API access is refused", (await fetch(`${BASE}/api/v1/products`)).status === 401);

    const noTotp = await post("/auth/login", { email: EMAIL, password: PASSWORD });
    check("correct password without TOTP is refused (no cookie)", noTotp.status === 401 && !noTotp.headers.get("set-cookie"));
    const badTotp = await post("/auth/login", { email: EMAIL, password: PASSWORD, totp: "000000" });
    check("wrong TOTP is refused", badTotp.status === 401 && !badTotp.headers.get("set-cookie"));
    const foreign = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, totp: totpAt(created.secret, totpStep(Date.now()) + 1) }) });
    check("login from a foreign Origin is refused", foreign.status === 403);

    // the previous step did not consume a code (refused before verification); log in for real
    let login: Response | null = null;
    for (const offset of [1, 0, -1]) {
      login = await post("/auth/login", { email: EMAIL, password: PASSWORD, totp: totpAt(created.secret, totpStep(Date.now()) + offset) });
      if (login.status === 200) break;
    }
    const session = (await login!.json()) as { csrfToken: string; role: string; permissions: string[] };
    const setCookie = login!.headers.get("set-cookie") ?? "";
    const cookie = setCookie.split(";")[0] ?? "";
    check("login with password + TOTP succeeds", login!.status === 200 && session.role === "owner" && session.permissions.includes("product:publish"));
    check("session cookie is __Host-, Secure, HttpOnly, SameSite=Strict", /^__Host-jm_session=/.test(setCookie) && /secure/i.test(setCookie) && /httponly/i.test(setCookie) && /samesite=strict/i.test(setCookie));

    const authed = { cookie, "x-csrf-token": session.csrfToken };
    check("mutation without CSRF token is refused", (await post("/products", { name: "x" }, { cookie })).status === 403);
    const created2 = await post("/products", { name: "محصول آزمایشی", status: "draft", fulfillment: "unique", inventory: 1, priceToman: 999999999999999 }, authed);
    const product = (await created2.json()) as { product: { id: string; priceToman: number } };
    check("product creation works; a 15-digit price is exact", created2.status === 201 && product.product.priceToman === 999999999999999);

    const png = solidPng(30, 40, [120, 140, 90]);
    const upload = await fetch(`${BASE}/api/v1/products/${product.product.id}/images`, { method: "POST", headers: { origin: ORIGIN, "content-type": "image/png", ...authed }, body: new Uint8Array(png) });
    const image = (await upload.json()) as { key: string };
    check("image upload stores and serves media on the same origin", upload.status === 201 && (await fetch(`${BASE}/media/${image.key}`)).status === 200);

    // 4. the data really is in the private PostgreSQL 16
    const count = execFileSync(join(process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin", "psql"), ["-h", "127.0.0.1", "-p", process.env.JARYAN_PG_PORT ?? "5433", "-U", "jaryan", "-d", "jaryan", "-tAc", "SELECT count(*) || ' ' || current_setting('server_version_num')::int/10000 FROM products"], { env: { ...process.env, PGPASSWORD: execFileSync("cat", [join(state, "db.pass")]).toString().trim() } }).toString().trim();
    check("product is stored in PostgreSQL 16", count === "1 16", count);
  } finally {
    try { process.kill(-(server.pid as number), "SIGTERM"); } catch { /* already gone */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { execFileSync(join(process.env.PG_BIN ?? "/usr/lib/postgresql/16/bin", "pg_ctl"), ["-D", join(state, "pg"), "stop", "-m", "fast"], { stdio: "ignore" }); } catch { /* not running */ }
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

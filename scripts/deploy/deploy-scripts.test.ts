import { spawn } from "node:child_process";
import { chmodSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const verify = join(process.cwd(), "scripts/deploy/verify-live.sh");
const waitFor = join(process.cwd(), "scripts/deploy/wait-for-checks.sh");
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Async on purpose: the fake site lives in this process, so the script must not block the event loop. */
function run(file: string, args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = "";
    const child = spawn("bash", [file, ...args], { env: { ...process.env, ...env } });
    child.stdout.on("data", (d: Buffer) => (out += d));
    child.stderr.on("data", (d: Buffer) => (out += d));
    child.on("close", (status) => resolve({ status, out }));
  });
}

describe("verify-live.sh (is the live site really serving the deployed commit?)", () => {
  let server: Server;
  let base = "";
  let serve: (path: string) => { status: number; body: string };

  beforeEach(async () => {
    serve = () => ({ status: 404, body: "" });
    server = createServer((req, res) => {
      const { status, body } = serve(new URL(req.url ?? "/", "http://x").pathname);
      res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => new Promise<void>((r) => server.close(() => r())));

  const site = (commit: string) => (path: string) => (path === "/build-info.json" ? { status: 200, body: JSON.stringify({ commit }) } : { status: 200, body: "<html><title>جریان ما</title></html>" });
  const runAsync = (args: string[]) => run(verify, args, { VERIFY_POLL_SECONDS: "1" });

  it("passes when the site serves the expected commit and its pages answer", async () => {
    serve = site(SHA);
    const r = await runAsync([base, SHA, "10"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Verified");
  });

  it("fails when the site still serves an older commit (a deployment that did not go live)", async () => {
    serve = site("f".repeat(40));
    const r = await runAsync([base, SHA, "3"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("does not serve the deployed commit");
  });

  it("waits for propagation: succeeds once the new commit appears", async () => {
    let calls = 0;
    serve = (path) => (path === "/build-info.json" ? { status: 200, body: JSON.stringify({ commit: ++calls < 3 ? "e".repeat(40) : SHA }) } : site(SHA)(path));
    const r = await runAsync([base, SHA, "20"]);
    expect(r.status).toBe(0);
  });

  it("fails when a shop page does not answer 200", async () => {
    serve = (path) => (path === "/checkout" ? { status: 500, body: "" } : site(SHA)(path));
    const r = await runAsync([base, SHA, "5"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("/checkout answered HTTP 500");
  });

  it("fails when a page answers 200 but is not the storefront (e.g. a Cloudflare error page)", async () => {
    serve = (path) => (path === "/cart" ? { status: 200, body: "<html>Error 1000</html>" } : site(SHA)(path));
    const r = await runAsync([base, SHA, "5"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("not the Jaryan Ma storefront");
  });

  it("fails fast when nothing answers at all", async () => {
    const r = await runAsync(["http://127.0.0.1:9", SHA, "2"]);
    expect(r.status).toBe(1);
  });
});

describe("wait-for-checks.sh (production waits for every other check)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wait-checks-"));
  });
  afterEach(async () => rm(dir, { recursive: true, force: true }));

  /** A stub `gh` that prints the next scripted snapshot of check runs ("name<TAB>status<TAB>conclusion" lines), repeating the last. */
  async function stubGh(snapshots: string[][]): Promise<Record<string, string>> {
    for (const [i, lines] of snapshots.entries()) await writeFile(join(dir, `snap${i}`), lines.join("\n") + "\n");
    const script = `#!/usr/bin/env bash
n=$(cat "${dir}/count" 2>/dev/null || echo 0)
last=${snapshots.length - 1}
idx=$(( n > last ? last : n ))
echo $((n+1)) > "${dir}/count"
cat "${dir}/snap$idx"
`;
    const path = join(dir, "gh");
    await writeFile(path, script);
    chmodSync(path, 0o755);
    return { PATH: `${dir}:${process.env.PATH}`, CHECK_POLL_SECONDS: "1" };
  }
  const call = (env: Record<string, string>, timeout = "10") => run(waitFor, ["o/r", SHA, timeout, "Check and build|Deploy to Cloudflare Pages"], env);

  it("passes when every other check is green (own jobs ignored)", async () => {
    const env = await stubGh([["Check and build\tin_progress\t", "Deploy to Cloudflare Pages\tin_progress\t", "Tests on PostgreSQL 16\tcompleted\tsuccess", "SEO output\tcompleted\tskipped"]]);
    const r = await call(env);
    expect(r.status).toBe(0);
    expect(r.out).toContain("green");
  });

  it("passes when no other check exists for the commit", async () => {
    const env = await stubGh([["Check and build\tin_progress\t"]]);
    expect((await call(env)).status).toBe(0);
  });

  it("waits while a check is still running, then passes", async () => {
    const env = await stubGh([["Build, unit tests, browser tests\tin_progress\t"], ["Build, unit tests, browser tests\tin_progress\t"], ["Build, unit tests, browser tests\tcompleted\tsuccess"]]);
    const r = await call(env);
    expect(r.status).toBe(0);
    expect(r.out).toContain("Waiting for: Build, unit tests, browser tests");
  });

  it.each(["failure", "timed_out", "cancelled", "action_required"])("holds the deployment back on a %s check", async (conclusion) => {
    const env = await stubGh([[`Tests on PostgreSQL 16\tcompleted\t${conclusion}`, "SEO output\tin_progress\t"]]);
    const r = await call(env);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Tests on PostgreSQL 16");
  });

  it("gives up when a check never finishes", async () => {
    const env = await stubGh([["Build, unit tests, browser tests\tqueued\t"]]);
    const r = await call(env, "3");
    expect(r.status).toBe(1);
    expect(r.out).toContain("Timed out");
  });
});

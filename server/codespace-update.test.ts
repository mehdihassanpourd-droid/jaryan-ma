import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * The Codespaces updater must only ever move a checkout FORWARD to the latest main, must keep the user's data and local
 * work safe, and must apply (only) what changed. These tests run the real script against real git repositories.
 */
const REPO = join(import.meta.dirname, "..");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();

let root: string;
let origin: string; // bare remote
let author: string; // plays "the maintainers": pushes to main
let codespace: string; // the checkout inside the Codespace

const write = (dir: string, path: string, content: string) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
};
const commitAll = (dir: string, message: string) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
  return git(dir, "rev-parse", "HEAD");
};
const update = (extraEnv: Record<string, string> = {}) => {
  const r = spawnSync("bash", [join(codespace, "scripts/codespace/update.sh")], { cwd: codespace, env: { ...GIT_ENV, JARYAN_UPDATE_DRY: "1", ...extraEnv }, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jm-upd-"));
  origin = join(root, "origin.git");
  author = join(root, "author");
  codespace = join(root, "codespace");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin], { env: GIT_ENV });
  execFileSync("git", ["clone", "-q", origin, author], { env: GIT_ENV });
  git(author, "checkout", "-q", "-b", "main");
  mkdirSync(join(author, "scripts/codespace"), { recursive: true });
  for (const f of readdirSync(join(REPO, "scripts/codespace")).filter((n) => n.endsWith(".sh"))) copyFileSync(join(REPO, "scripts/codespace", f), join(author, "scripts/codespace", f));
  write(author, ".gitignore", ".data/\ndist/\n");
  write(author, "package.json", '{"name":"x"}\n');
  write(author, "package-lock.json", "{}\n");
  write(author, "README.md", "v1\n");
  commitAll(author, "v1");
  git(author, "push", "-q", "-u", "origin", "main");
  execFileSync("git", ["clone", "-q", origin, codespace], { env: GIT_ENV });
  // the user's data: git-ignored, must survive every update
  write(codespace, ".data/codespace/pg/PG_VERSION", "16\n");
  write(codespace, ".data/codespace/data/media/images/a.png", "PNG");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const publish = (path: string, content: string, message = "change") => {
  write(author, path, content);
  commitAll(author, message);
  git(author, "push", "-q", "origin", "main");
};
const head = () => git(codespace, "rev-parse", "HEAD");
const dataIntact = () => readFileSync(join(codespace, ".data/codespace/pg/PG_VERSION"), "utf8") === "16\n" && existsSync(join(codespace, ".data/codespace/data/media/images/a.png"));

describe("codespace update.sh", () => {
  it("does nothing when already up to date", () => {
    const before = head();
    const r = update();
    expect(r.status).toBe(0);
    expect(r.out).toContain("already up to date");
    expect(head()).toBe(before);
  });

  it("fast-forwards to the latest main and keeps the data directory", () => {
    publish("README.md", "v2\n");
    const r = update();
    expect(r.status).toBe(0);
    expect(r.out).toContain("updated");
    expect(head()).toBe(git(author, "rev-parse", "HEAD"));
    expect(readFileSync(join(codespace, "README.md"), "utf8")).toBe("v2\n");
    expect(dataIntact()).toBe(true);
  });

  it("applies only what changed: nothing for a docs change", () => {
    publish("README.md", "v2\n");
    const r = update();
    expect(r.out).not.toMatch(/would run/);
  });

  it("reinstalls dependencies, migrates and rebuilds the admin only when those files changed", () => {
    publish("package-lock.json", '{"a":1}\n');
    expect(update().out).toMatch(/would run: npm ci/);

    publish("prisma/migrations/20270101000000_x/migration.sql", "SELECT 1;\n");
    const r2 = update();
    expect(r2.out).toMatch(/would run: prisma migrate deploy/);
    expect(r2.out).not.toMatch(/npm ci/);

    publish("admin/src/main.tsx", "// ui\n");
    expect(update().out).toMatch(/would run: npm run --silent admin:build/);
    expect(dataIntact()).toBe(true);
  });

  it("moves a merged feature branch onto main (nothing is lost: it is already contained in main)", () => {
    git(codespace, "checkout", "-q", "-b", "claude/feature");
    publish("README.md", "v2\n");
    const r = update();
    expect(r.out).toContain("switching to main");
    expect(git(codespace, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(head()).toBe(git(author, "rev-parse", "HEAD"));
  });

  it("refuses when tracked files have local edits, and leaves them untouched", () => {
    publish("README.md", "v2\n");
    write(codespace, "README.md", "my edit\n");
    const before = head();
    const r = update();
    expect(r.status).toBe(0);
    expect(r.out).toContain("local changes");
    expect(head()).toBe(before);
    expect(readFileSync(join(codespace, "README.md"), "utf8")).toBe("my edit\n");
  });

  it("refuses when this checkout has commits that are not on main (a feature branch with unpushed work)", () => {
    git(codespace, "checkout", "-q", "-b", "claude/work");
    write(codespace, "notes.txt", "mine\n");
    const mine = commitAll(codespace, "my work");
    publish("README.md", "v2\n");
    const r = update();
    expect(r.out).toContain("not on main");
    expect(head()).toBe(mine);
    expect(git(codespace, "rev-parse", "--abbrev-ref", "HEAD")).toBe("claude/work");
  });

  it("refuses when local main has diverged", () => {
    write(codespace, "notes.txt", "local only\n");
    const mine = commitAll(codespace, "local commit on main");
    publish("README.md", "v2\n");
    const r = update();
    expect(r.out).toContain("not on main");
    expect(head()).toBe(mine);
  });

  it("never blocks start-up: an unreachable remote is reported and the version is kept", () => {
    rmSync(origin, { recursive: true, force: true });
    const before = head();
    const r = update();
    expect(r.status).toBe(0);
    expect(r.out).toContain("cannot reach");
    expect(head()).toBe(before);
    expect(dataIntact()).toBe(true);
  });
});

describe("safety of the Codespaces scripts", () => {
  const scripts = readdirSync(join(REPO, "scripts/codespace")).filter((n) => n.endsWith(".sh")).map((n) => readFileSync(join(REPO, "scripts/codespace", n), "utf8"));

  it("never resets, cleans, force-pushes or deletes user data", () => {
    for (const source of scripts) {
      const code = source.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
      expect(code).not.toMatch(/git\s+reset\s+--hard|git\s+clean|git\s+push|--force|git\s+stash\s+drop|rm\s+-rf\s+("?\$STATE|"?\$ROOT\/\.data|\.data)/);
    }
  });
});

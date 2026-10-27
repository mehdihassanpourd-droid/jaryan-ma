import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = join(process.cwd(), "scripts/seo/data-branch.sh");
let root: string;
let remote: string;
let work: string;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
const sh = (cwd: string, arg: string) => execFileSync("bash", [script, arg], { cwd, encoding: "utf8", env: { ...process.env, GH_TOKEN: "test-token", REPO: "o/r", SEO_DATA_REMOTE: remote } });

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "seo-branch-"));
  remote = join(root, "remote.git");
  git(root, "init", "--bare", "-q", remote);
  work = join(root, "work");
  await mkdir(work);
  git(work, "init", "-q", "-b", "main");
  git(work, "config", "user.email", "t@t");
  git(work, "config", "user.name", "t");
  await writeFile(join(work, "code.txt"), "code");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "init");
});
afterEach(async () => rm(root, { recursive: true, force: true }));

describe("history branch script", () => {
  it("creates an orphan branch the first time, publishes new data, and a re-run with nothing new commits nothing", async () => {
    sh(work, "prepare");
    expect(existsSync(join(work, ".seo-data", "README.md"))).toBe(true);
    expect(existsSync(join(work, ".seo-data", "code.txt"))).toBe(false); // history only, never code
    await mkdir(join(work, ".seo-data", "days"), { recursive: true });
    await writeFile(join(work, ".seo-data", "days", "2026-11-01.json"), "{}");
    sh(work, "publish");
    expect(git(root, "-C", remote, "log", "--format=%s", "seo-data").trim()).toMatch(/^SEO data /);
    expect(git(root, "-C", remote, "branch", "--list").includes("main")).toBe(false); // main is never written
    const heads = git(root, "-C", remote, "rev-parse", "seo-data").trim();
    expect(sh(work, "publish")).toContain("nothing to commit");
    expect(git(root, "-C", remote, "rev-parse", "seo-data").trim()).toBe(heads);
  });

  it("a later run (fresh checkout) continues the same history, and an identical day adds no commit", async () => {
    sh(work, "prepare");
    await mkdir(join(work, ".seo-data", "days"), { recursive: true });
    await writeFile(join(work, ".seo-data", "days", "2026-11-01.json"), "{}");
    sh(work, "publish");
    git(work, "worktree", "remove", "--force", ".seo-data");
    git(work, "branch", "-D", "seo-data");
    sh(work, "prepare"); // the next day's runner
    expect(await readFile(join(work, ".seo-data", "days", "2026-11-01.json"), "utf8")).toBe("{}");
    await writeFile(join(work, ".seo-data", "days", "2026-11-02.json"), "{}");
    sh(work, "publish");
    expect(git(root, "-C", remote, "rev-list", "--count", "seo-data").trim()).toBe("2");
    await writeFile(join(work, ".seo-data", "days", "2026-11-02.json"), "{}"); // same bytes again
    expect(sh(work, "publish")).toContain("nothing to commit");
    expect(git(root, "-C", remote, "rev-list", "--count", "seo-data").trim()).toBe("2");
  });

  it("refuses to run without a token and rejects unknown commands", () => {
    expect(() => execFileSync("bash", [script, "prepare"], { cwd: work, env: { ...process.env, GH_TOKEN: "", REPO: "o/r" }, stdio: "pipe" })).toThrow();
    expect(() => sh(work, "nope")).toThrow();
  });
});

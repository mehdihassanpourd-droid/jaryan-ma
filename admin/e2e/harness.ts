import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { totpAt, totpStep } from "../../server/auth/totp";

export interface Account {
  email: string;
  password: string;
  secret: string;
}
export interface Harness {
  baseUrl: string;
  accounts: Record<"owner" | "editor" | "viewer", Account>;
  browser: Browser;
  /** A TOTP code never used before for this account (the server refuses replays), or throws when the window is exhausted. */
  code(account: Account): string;
  login(context: BrowserContext, account: Account): Promise<Page>;
  /** Last lines of the server's own output (JSON log lines), for failure diagnostics. */
  serverLog(lines?: number): string;
  stop(): Promise<void>;
}

const root = join(import.meta.dirname, "../..");
const tsx = join(root, "node_modules/.bin/tsx");

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

async function waitFor(url: string, child: ChildProcess, logs: () => string): Promise<void> {
  for (let i = 0; i < 240; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${logs()}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${logs()}`);
}

/** Boots the REAL server (embedded PostgreSQL, local-disk media, mandatory TOTP) and the built admin UI. Nothing is mocked. */
export async function startHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), "jm-e2e-"));
  const port = await freePort();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "development" as const,
    PORT: String(port),
    HOST: "127.0.0.1",
    DEV_DATA_DIR: join(dir, "data"),
    REQUIRE_TOTP: "true",
    COOKIE_SECURE: "false",
    SCRYPT_LOG_N: "10",
    SCHEDULER_ENABLED: "false",
    CUSTOMER_ACCOUNTS_ENABLED: "false",
    ADMIN_UI_DIR: join(root, "dist/admin"),
    ADMIN_ORIGINS: `http://127.0.0.1:${port}`,
    IMPORT_CHUNK_MAX: "50",
  };
  const accountsFile = join(dir, "accounts.json");
  execFileSync(tsx, [join(root, "admin/e2e/seed.ts"), accountsFile], { env, cwd: root, stdio: "pipe" });
  const accounts = JSON.parse(readFileSync(accountsFile, "utf8")) as Harness["accounts"];

  let output = "";
  const child = spawn(tsx, [join(root, "server/main.ts")], { env, cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  child.stderr?.on("data", (d: Buffer) => (output += d.toString()));
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(`${baseUrl}/admin/`, child, () => output.slice(-3000));
  const browser = await chromium.launch();

  const used = new Map<string, number>();
  const code = (account: Account) => {
    const current = totpStep(Date.now());
    const last = used.get(account.email) ?? current - 2;
    const step = Math.max(last + 1, current - 1);
    if (step > current + 1) throw new Error("no unused TOTP step left; wait up to 30 s");
    used.set(account.email, step);
    return totpAt(account.secret, step);
  };

  return {
    baseUrl,
    accounts,
    browser,
    code,
    serverLog: (lines = 40) => output.split("\n").slice(-lines).join("\n"),
    async login(context, account) {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/admin/`);
      await page.getByLabel("ایمیل").fill(account.email);
      await page.getByLabel(/^گذرواژه/).fill(account.password);
      await page.getByLabel(/کد دومرحله‌ای/).fill(code(account));
      await page.getByRole("button", { name: "ورود" }).click();
      await page.getByRole("navigation", { name: "بخش‌های مدیریت" }).waitFor();
      return page;
    },
    async stop() {
      await browser.close();
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 500));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigError, loadConfig, type Config } from "../config";
import { RateLimiter } from "../auth/rate-limit";
import { parseBackupKey, pruneBackups, restoreTest, takeBackup, type BackupManifest } from "../maintenance/backup-tools";
import { createPlatformServices } from "../services";
import { checkMigrations, createSmsProvider, createStorage, openDatabase, resolveMasterKey, securityFacts } from "../runtime";
import { randomBytes } from "node:crypto";
import type { Operator } from "../maintenance/service";

/**
 * Operations CLI (run on the server by whoever operates it; there is no HTTP surface for these).
 *
 *   npm run ops -- health                       full health report; exit 1 when down, 2 when degraded
 *   npm run ops -- security-check               configuration review; exit 1 on any failure
 *   npm run ops -- backup                       pg_dump -> encrypted file + manifest; records it as TAKEN (not verified)
 *   npm run ops -- restore-test [--file F]      restores the newest (or given) backup into a scratch database and verifies it
 *   npm run ops -- backup-status                what is actually proven (never "ok" without a successful restore test)
 *   npm run ops -- log-action --action A --outcome success|failure [--target T] [--actor U]
 *   npm run ops -- run-deletions | purge | faq-seed
 *
 * Environment (besides the server's own): BACKUP_DIR (default ./backups), BACKUP_ENCRYPTION_KEY (base64, 32 bytes),
 * BACKUP_KEEP_DAYS (default 30), RESTORE_TEST_ADMIN_URL (a CREATEDB connection to a SCRATCH PostgreSQL server).
 */
const OWNER: Operator = { email: "ops-cli", role: "owner" };

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function latestBackupFile(dir: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const files = (await readdir(dir)).filter((f) => /^jaryan-db-.*\.dump(\.enc)?$/.test(f)).sort();
  const newest = files.at(-1);
  if (!newest) throw new Error(`no backup files in ${dir}`);
  return join(dir, newest);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  let config: Config;
  try {
    config = loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  const database = await openDatabase(config, () => undefined);
  const { db } = database;
  const { storage } = createStorage(config, () => undefined);
  const services = createPlatformServices({
    db,
    masterKey: resolveMasterKey(config),
    sms: createSmsProvider(config),
    limiter: new RateLimiter(),
    customerCookie: { name: "jm_c", secure: config.cookieSecure },
    // The CLI never places orders; checkout is only wired in the server.
    catalog: { getPublishedBySlugs: async () => { throw new Error("checkout_not_available_in_cli"); } },
    vendorId: "",
    probes: {
      database: async () => void (await db.$queryRaw`SELECT 1`),
      migrations: () => checkMigrations(db, config.production),
      storage: async () => {
        const key = `_health/probe-${randomBytes(6).toString("hex")}`;
        await storage.put(key, "ok", { contentType: "text/plain" });
        await storage.delete([key]);
      },
      security: () => securityFacts(config, database.embedded),
    },
  });
  const { maintenance } = services;
  const dir = process.env.BACKUP_DIR ?? "backups";
  let exit = 0;

  try {
    switch (command) {
      case "health": {
        const report = await maintenance.runHealth();
        console.log(JSON.stringify(report, null, 2));
        exit = report.status === "down" ? 1 : report.status === "degraded" ? 2 : 0;
        break;
      }
      case "security-check": {
        const { securityChecks } = await import("../../src/domain/maintenance/security-checks");
        const results = securityChecks(securityFacts(config, database.embedded));
        for (const r of results) console.log(`${r.status.toUpperCase().padEnd(4)} ${r.name}: ${r.message}`);
        exit = results.some((r) => r.status === "fail") ? 1 : 0;
        await maintenance.logAction("ops-cli", "security.check", null, exit === 0 ? "success" : "failure", { failing: results.filter((r) => r.status === "fail").map((r) => r.name) });
        break;
      }
      case "backup": {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const started = new Date();
        try {
          const result = await takeBackup({ databaseUrl: config.databaseUrl ?? "", directory: dir, encryptionKey: process.env.BACKUP_ENCRYPTION_KEY, now: started });
          const row = await maintenance.recordBackup(OWNER, { kind: "database", takenAt: started, sizeBytes: result.sizeBytes, location: result.file, sha256: result.sha256, encrypted: result.encrypted });
          await maintenance.logAction("ops-cli", "backup.taken", `backup:${row.id}`, "success", { sizeBytes: result.sizeBytes, encrypted: result.encrypted });
          const removed = await pruneBackups(dir, Number(process.env.BACKUP_KEEP_DAYS ?? 30));
          console.log(`Backup written: ${result.file} (${result.sizeBytes} bytes, ${removed} old file(s) pruned).`);
          console.log("This backup is NOT verified yet. Run `restore-test` to prove it can be restored.");
        } catch (error) {
          await maintenance.logAction("ops-cli", "backup.taken", null, "failure", { error: error instanceof Error ? error.message : "unknown" });
          throw error;
        }
        break;
      }
      case "restore-test": {
        const scratch = process.env.RESTORE_TEST_ADMIN_URL;
        if (!scratch) throw new Error("RESTORE_TEST_ADMIN_URL is required (a CREATEDB connection to a scratch PostgreSQL server)");
        if (config.databaseUrl && new URL(scratch).host === new URL(config.databaseUrl).host && !args.includes("--allow-same-server")) {
          throw new Error("RESTORE_TEST_ADMIN_URL points at the production server; use a scratch server, or pass --allow-same-server to accept the extra load");
        }
        const file = option(args, "file") ?? (await latestBackupFile(dir));
        const manifestFile = file.replace(/\.dump(\.enc)?$/, ".manifest.json");
        const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as BackupManifest;
        if (manifest.encrypted) parseBackupKey(process.env.BACKUP_ENCRYPTION_KEY);
        const record = (await maintenance.listBackups(OWNER, "database")).find((b) => b.sha256 === manifest.dumpSha256);
        const result = await restoreTest({ file, manifestFile, scratchAdminUrl: scratch, encryptionKey: process.env.BACKUP_ENCRYPTION_KEY });
        for (const note of result.notes) console.log(`  ${note}`);
        if (record) await maintenance.recordRestoreTest(OWNER, record.id, result.ok, result.notes.join("; "));
        else console.log("  (this file is not in the backup register, so the result was not recorded)");
        await maintenance.logAction("ops-cli", "backup.restore_test", record ? `backup:${record.id}` : file, result.ok ? "success" : "failure", { notes: result.notes });
        console.log(result.ok ? "RESTORE TEST PASSED" : "RESTORE TEST FAILED");
        exit = result.ok ? 0 : 1;
        break;
      }
      case "backup-status": {
        const status = await maintenance.backupStatus();
        console.log(JSON.stringify(status, null, 2));
        exit = status.database.operational ? 0 : 1;
        break;
      }
      case "log-action": {
        const action = option(args, "action");
        const outcome = option(args, "outcome");
        if (!action || (outcome !== "success" && outcome !== "failure")) throw new Error("usage: log-action --action <name> --outcome success|failure [--target T] [--actor U]");
        await maintenance.logAction(option(args, "actor") ?? "ops-cli", action, option(args, "target") ?? null, outcome);
        break;
      }
      case "run-deletions":
        console.log(`Erased ${await services.accounts.runDeletions()} account(s).`);
        break;
      case "purge":
        console.log(JSON.stringify({ customers: await services.customerAuth.purge(), maintenance: await maintenance.prune(), closedTickets: await services.support.autoCloseResolved() }));
        break;
      case "faq-seed":
        console.log(`Added ${await services.support.seedDefaultFaq()} FAQ draft(s).`);
        break;
      default:
        console.error("Commands: health, security-check, backup, restore-test, backup-status, log-action, run-deletions, purge, faq-seed");
        exit = 64;
    }
  } finally {
    await database.stop();
  }
  process.exit(exit);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exit(1);
});

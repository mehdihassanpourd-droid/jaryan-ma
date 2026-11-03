import { Client } from "pg";
import { classifySchema, deployMigrations, MigrationError, migrationStatus, SCHEMA_EXIT } from "../db/migrate";
import { findMigrationsDir, readMigrations } from "../db/migrations";

/**
 * Database migrations for a production install that has no Prisma CLI, no npm and no network.
 *
 *   migrate status            what is applied / pending / modified (read-only); exit 0 = nothing pending, 3 = pending, 1 = problem
 *   migrate check             is the database compatible with THIS release? Read-only; prints migration NAMES only.
 *                              exit 0 compatible · 65 database has migrations this release does not know (newer_unknown)
 *                              · 66 failed/unfinished/modified · 67 this release has migrations not applied (missing)
 *   migrate deploy            apply pending migrations (each in its own transaction); exit 0 ok, 1 failed
 *   migrate deploy --dry-run  list what would be applied; changes nothing
 *
 * Reads DATABASE_URL (and optional MIGRATIONS_DIR). It never prints the connection string. It NEVER reverses a migration.
 */
async function main() {
  const [command = "status", ...args] = process.argv.slice(2);
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(64);
  }
  const files = readMigrations();
  if (files.length === 0) {
    console.error(`no migration files found in ${findMigrationsDir()}`);
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch {
    // never print the driver's message: it can contain the host and user name
    console.error("cannot connect to the database");
    process.exit(1);
  }
  let exit = 0;
  try {
    if (command === "status") {
      const status = await migrationStatus(client, files);
      console.log(JSON.stringify(status, null, 2));
      exit = !status.ok ? 1 : status.pending.length > 0 ? 3 : 0;
    } else if (command === "check") {
      const status = await migrationStatus(client, files);
      const state = classifySchema(status);
      console.log(JSON.stringify({ state, unknownToRelease: status.unknownToRelease, pending: status.pending, modified: status.modified, unfinished: status.unfinished }));
      exit = SCHEMA_EXIT[state];
    } else if (command === "deploy") {
      const dryRun = args.includes("--dry-run");
      const result = await deployMigrations(client, files, { dryRun, log: (line) => console.log(line) });
      console.log(dryRun ? `would apply ${result.status.pending.length} migration(s): ${result.status.pending.join(", ") || "none"}` : `applied ${result.appliedNow.length} migration(s); ${result.status.pending.length} pending`);
      if (result.status.unknownToRelease.length > 0) console.log(`note: the database has ${result.status.unknownToRelease.length} migration(s) newer than this release (normal right after an application rollback)`);
      if (!result.status.ok) exit = 1;
    } else {
      console.error("Commands: status, check, deploy [--dry-run]");
      exit = 64;
    }
  } catch (error) {
    console.error(error instanceof MigrationError ? error.message : "migration run failed");
    exit = 1;
  } finally {
    await client.end();
  }
  process.exit(exit);
}

void main();

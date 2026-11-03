import { createHash, randomUUID } from "node:crypto";
import type { Migration } from "./migrations";

/**
 * Applies the SQL migrations in prisma/migrations WITHOUT the Prisma CLI, so a production server needs no npm, no schema-engine
 * download and no network. It keeps the very same bookkeeping table (`_prisma_migrations`, checksum = SHA-256 of migration.sql)
 * that `prisma migrate deploy` uses, so the two can be mixed and `checkMigrations` keeps working.
 *
 * Safety rules:
 *  - one session-level advisory lock: two installers can never migrate at once;
 *  - every migration runs in ONE transaction together with its bookkeeping row: it is applied completely or not at all;
 *  - an already applied migration whose file changed is an error (never "fixed" silently);
 *  - a migration that Prisma left unfinished (started, never finished) blocks everything until a person looks at it;
 *  - the database being NEWER than the release (applied migrations this release does not contain) is reported, not an error:
 *    that is exactly the state after rolling the application back one release;
 *  - nothing is ever rolled back, dropped or reset.
 */
export interface SqlClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface AppliedRow {
  migration_name: string;
  checksum: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export interface MigrationStatus {
  applied: string[];
  pending: string[];
  /** Applied in the database but not part of this release (the database is newer than the application). */
  unknownToRelease: string[];
  /** Applied, but the file in this release has a different checksum. */
  modified: string[];
  /** Started but never finished (a failed Prisma run). */
  unfinished: string[];
  ok: boolean;
}

export const checksumOf = (sql: string): string => createHash("sha256").update(sql).digest("hex");

const LOCK_KEY = 7_104_220_411; // arbitrary constant: "jaryan-ma migrate"

const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
  "id" VARCHAR(36) PRIMARY KEY NOT NULL,
  "checksum" VARCHAR(64) NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "migration_name" VARCHAR(255) NOT NULL,
  "logs" TEXT,
  "rolled_back_at" TIMESTAMPTZ,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "applied_steps_count" INTEGER NOT NULL DEFAULT 0
)`;

export function planMigrations(files: readonly Migration[], rows: readonly AppliedRow[]): MigrationStatus {
  const finished = rows.filter((r) => r.finished_at !== null && r.rolled_back_at === null);
  const byName = new Map(finished.map((r) => [r.migration_name, r]));
  const known = new Set(files.map((f) => f.name));
  const applied = files.filter((f) => byName.has(f.name)).map((f) => f.name);
  const pending = files.filter((f) => !byName.has(f.name)).map((f) => f.name);
  const modified = files.filter((f) => byName.has(f.name) && byName.get(f.name)?.checksum !== checksumOf(f.sql)).map((f) => f.name);
  const unknownToRelease = finished.filter((r) => !known.has(r.migration_name)).map((r) => r.migration_name);
  const unfinished = rows.filter((r) => r.finished_at === null && r.rolled_back_at === null).map((r) => r.migration_name);
  return { applied, pending, unknownToRelease, modified, unfinished, ok: modified.length === 0 && unfinished.length === 0 };
}

async function readRows(client: SqlClient): Promise<AppliedRow[]> {
  const exists = (await client.query<{ t: string | null }>(`SELECT to_regclass('_prisma_migrations')::text AS t`)).rows[0]?.t;
  if (!exists) return [];
  return (await client.query<AppliedRow>(`SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"`)).rows;
}

/** Read-only: what would `deploy` do? Never creates anything. */
export async function migrationStatus(client: SqlClient, files: readonly Migration[]): Promise<MigrationStatus> {
  return planMigrations(files, await readRows(client));
}

export interface DeployResult {
  status: MigrationStatus;
  appliedNow: string[];
}

export class MigrationError extends Error {
  constructor(public code: "modified" | "unfinished" | "locked" | "failed", message: string, public migration?: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export async function deployMigrations(client: SqlClient, files: readonly Migration[], options: { dryRun?: boolean; log?: (line: string) => void } = {}): Promise<DeployResult> {
  const log = options.log ?? (() => undefined);
  if (options.dryRun) {
    const status = await migrationStatus(client, files);
    return { status, appliedNow: [] };
  }
  const got = (await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK_KEY])).rows[0]?.ok;
  if (!got) throw new MigrationError("locked", "another migration run is in progress");
  try {
    await client.query(CREATE_TABLE);
    const status = planMigrations(files, await readRows(client));
    if (status.unfinished.length > 0) throw new MigrationError("unfinished", `migration ${status.unfinished[0]} was started earlier and never finished; inspect the database before continuing (see ROLLBACK-FA.md)`, status.unfinished[0]);
    if (status.modified.length > 0) throw new MigrationError("modified", `migration ${status.modified[0]} was already applied but its file has changed; this release does not match the database`, status.modified[0]);
    const appliedNow: string[] = [];
    for (const name of status.pending) {
      const file = files.find((f) => f.name === name) as Migration;
      log(`applying ${name}`);
      try {
        await client.query("BEGIN");
        await client.query(file.sql);
        await client.query(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ($1, $2, $3, now(), now(), 1)`, [randomUUID(), checksumOf(file.sql), name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw new MigrationError("failed", `migration ${name} failed and was rolled back completely: ${error instanceof Error ? error.message.split("\n")[0] : "error"}`, name);
      }
      appliedNow.push(name);
    }
    return { status: planMigrations(files, await readRows(client)), appliedNow };
  } finally {
    await client.query(`SELECT pg_advisory_unlock($1)`, [LOCK_KEY]).catch(() => undefined);
  }
}

import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Client } from "pg";

/**
 * Database backup and restore-test tooling (PostgreSQL, standard `pg_dump` / `pg_restore`).
 *
 * Nothing here declares a backup "working". A backup is recorded as taken; it only counts as
 * operational after `restoreTest` has restored it into a scratch database and compared the contents
 * with the manifest written at backup time (see src/domain/maintenance/backup.ts).
 */

/** Tables whose row counts are verified after a restore. All application tables are checked. */
export const MANIFEST_VERSION = 1;

export interface BackupManifest {
  version: number;
  takenAt: string;
  /** Row count of every table in the public schema at the exact snapshot the dump was taken from. */
  tables: Record<string, number>;
  /** Names of finished Prisma migrations at that snapshot. */
  migrations: string[];
  dumpSha256: string;
  encrypted: boolean;
}

/** Connection settings for child processes via PG* variables, so passwords never appear in argv / `ps`. */
export function pgEnv(connectionString: string, database?: string): Record<string, string> {
  const url = new URL(connectionString);
  const env: Record<string, string> = {};
  if (url.hostname) env.PGHOST = url.hostname;
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  env.PGDATABASE = database ?? decodeURIComponent(url.pathname.slice(1));
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

function run(command: string, args: string[], env: Record<string, string>): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { PATH: process.env.PATH ?? "", ...env } as unknown as NodeJS.ProcessEnv, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => void (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("error", (error) => reject(error));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

// ---- encryption (AES-256-GCM, streamed) -----------------------------------------------------------------

const MAGIC = Buffer.from("JMBK1");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseBackupKey(base64: string | undefined): Buffer {
  const key = Buffer.from(base64 ?? "", "base64");
  if (key.length !== 32) throw new Error("backup_key_invalid: BACKUP_ENCRYPTION_KEY must be 32 random bytes, base64-encoded");
  return key;
}

/** File layout: MAGIC | iv | ciphertext | tag. */
export async function encryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = createWriteStream(target, { mode: 0o600 });
  out.write(Buffer.concat([MAGIC, iv]));
  await pipeline(createReadStream(source), cipher, out, { end: false });
  await new Promise<void>((resolve, reject) => out.end(cipher.getAuthTag(), (error?: Error | null) => (error ? reject(error) : resolve())));
}

/** Throws when the key is wrong or the file was modified (authentication tag mismatch). */
export async function decryptFile(source: string, target: string, key: Buffer): Promise<void> {
  const size = (await stat(source)).size;
  if (size < MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("backup_file_too_short");
  const handle = await open(source, "r");
  try {
    const head = Buffer.alloc(MAGIC.length + IV_BYTES);
    await handle.read(head, 0, head.length, 0);
    if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("backup_file_format");
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    const input = createReadStream(source, { start: head.length, end: size - TAG_BYTES - 1 });
    await pipeline(input, decipher, createWriteStream(target, { mode: 0o600 }));
  } finally {
    await handle.close();
  }
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

// ---- backup ------------------------------------------------------------------------------------------

async function snapshotFacts(client: Client): Promise<{ tables: Record<string, number>; migrations: string[] }> {
  const names = (await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.table_name);
  const tables: Record<string, number> = {};
  for (const name of names) {
    // identifiers come from the catalog, quoted defensively
    tables[name] = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM "${name.replace(/"/g, '""')}"`)).rows[0]?.n ?? 0);
  }
  const migrations = tables._prisma_migrations !== undefined ? (await client.query<{ migration_name: string }>(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1`)).rows.map((r) => r.migration_name) : [];
  return { tables, migrations };
}

export interface BackupResult {
  file: string;
  manifestFile: string;
  sizeBytes: number;
  sha256: string;
  encrypted: boolean;
  manifest: BackupManifest;
}

export interface BackupOptions {
  databaseUrl: string;
  directory: string;
  /** 32-byte key (base64). Required unless `allowUnencrypted`. */
  encryptionKey?: string;
  allowUnencrypted?: boolean;
  now?: Date;
}

/**
 * Takes a consistent dump: the row counts in the manifest and the dump come from the SAME database snapshot
 * (pg_export_snapshot), so a restore can be verified exactly even while the site is taking writes.
 */
export async function takeBackup(options: BackupOptions): Promise<BackupResult> {
  if (!options.encryptionKey && !options.allowUnencrypted) throw new Error("backup_key_required: set BACKUP_ENCRYPTION_KEY (backups contain personal data)");
  const key = options.encryptionKey ? parseBackupKey(options.encryptionKey) : null;
  const takenAt = options.now ?? new Date();
  const stamp = takenAt.toISOString().replace(/[:.]/g, "-");
  const base = join(options.directory, `jaryan-db-${stamp}`);
  const rawFile = `${base}.dump`;

  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  let facts: Awaited<ReturnType<typeof snapshotFacts>>;
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query<{ s: string }>("SELECT pg_export_snapshot() AS s")).rows[0]?.s;
    if (!snapshot) throw new Error("snapshot_unavailable");
    const dump = await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--snapshot=${snapshot}`, `--file=${rawFile}`], pgEnv(options.databaseUrl));
    if (dump.code !== 0) throw new Error(`pg_dump_failed: ${dump.stderr.trim().split("\n").pop() ?? ""}`);
    facts = await snapshotFacts(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await rm(rawFile, { force: true });
    throw error;
  } finally {
    await client.end();
  }

  let file = rawFile;
  if (key) {
    file = `${rawFile}.enc`;
    await encryptFile(rawFile, file, key);
    await rm(rawFile, { force: true }); // the plaintext dump never stays on disk
  }
  const sha256 = await sha256File(file);
  const manifest: BackupManifest = { version: MANIFEST_VERSION, takenAt: takenAt.toISOString(), tables: facts.tables, migrations: facts.migrations, dumpSha256: sha256, encrypted: key !== null };
  const manifestFile = `${base}.manifest.json`;
  const handle = await open(manifestFile, "w", 0o600);
  await handle.writeFile(JSON.stringify(manifest, null, 2));
  await handle.close();
  return { file, manifestFile, sizeBytes: (await stat(file)).size, sha256, encrypted: key !== null, manifest };
}

/** Deletes backup files (and manifests) older than `keepDays`; returns the number of dump files removed. */
export async function pruneBackups(directory: string, keepDays: number, now = new Date()): Promise<number> {
  let removed = 0;
  for (const name of await readdir(directory)) {
    if (!name.startsWith("jaryan-db-")) continue;
    const path = join(directory, name);
    if (now.getTime() - (await stat(path)).mtimeMs > keepDays * 86_400_000) {
      await rm(path, { force: true });
      if (/\.dump(\.enc)?$/.test(name)) removed++;
    }
  }
  return removed;
}

// ---- restore test ------------------------------------------------------------------------------------

export interface RestoreTestOptions {
  file: string;
  manifestFile: string;
  /** Connection with CREATEDB on a SCRATCH server (never the production database). */
  scratchAdminUrl: string;
  encryptionKey?: string;
}

export interface RestoreTestResult {
  ok: boolean;
  /** Human-readable findings; contains no data values, only table names and counts. */
  notes: string[];
}

/** Restores into a throw-away database, compares it with the manifest, and always drops the scratch database. */
export async function restoreTest(options: RestoreTestOptions): Promise<RestoreTestResult> {
  const notes: string[] = [];
  const manifest = JSON.parse(await readFile(options.manifestFile, "utf8")) as BackupManifest;
  if ((await sha256File(options.file)) !== manifest.dumpSha256) return { ok: false, notes: ["backup file does not match the checksum in its manifest (corrupted or modified)"] };

  let dumpFile = options.file;
  let decrypted: string | null = null;
  if (manifest.encrypted) {
    decrypted = `${options.file}.restore-test.tmp`;
    try {
      await decryptFile(options.file, decrypted, parseBackupKey(options.encryptionKey));
    } catch (error) {
      await rm(decrypted, { force: true });
      return { ok: false, notes: [`could not decrypt: ${error instanceof Error ? error.message : "error"}`] };
    }
    dumpFile = decrypted;
  }

  const dbName = `jm_restore_test_${randomBytes(5).toString("hex")}`;
  const admin = new Client({ connectionString: options.scratchAdminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const restore = await run("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", `--dbname=${dbName}`, dumpFile], pgEnv(options.scratchAdminUrl, dbName));
    if (restore.code !== 0) return { ok: false, notes: [`pg_restore failed: ${restore.stderr.trim().split("\n").pop() ?? ""}`] };

    const scratchUrl = new URL(options.scratchAdminUrl);
    scratchUrl.pathname = `/${dbName}`;
    const scratch = new Client({ connectionString: scratchUrl.toString() });
    await scratch.connect();
    try {
      const restored = await snapshotFacts(scratch);
      const problems: string[] = [];
      for (const [table, expected] of Object.entries(manifest.tables)) {
        const actual = restored.tables[table];
        if (actual === undefined) problems.push(`table ${table} is missing`);
        else if (actual !== expected) problems.push(`table ${table}: expected ${expected} rows, restored ${actual}`);
      }
      for (const table of Object.keys(restored.tables)) if (manifest.tables[table] === undefined) problems.push(`unexpected table ${table}`);
      if (JSON.stringify(restored.migrations) !== JSON.stringify(manifest.migrations)) problems.push("migration history differs from the manifest");
      const totalRows = Object.values(restored.tables).reduce((a, b) => a + b, 0);
      notes.push(`restored ${Object.keys(restored.tables).length} tables, ${totalRows} rows`);
      if (problems.length > 0) return { ok: false, notes: [...notes, ...problems] };
      return { ok: true, notes: [...notes, "all table row counts and the migration history match the manifest"] };
    } finally {
      await scratch.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
    if (decrypted) await rm(decrypted, { force: true });
  }
}

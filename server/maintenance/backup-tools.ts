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
  /**
   * Optional content fingerprint per table (order-independent sum of a 64-bit hash of every row's text form, computed in the
   * same snapshot as the dump). A restore test compares it, which catches changed values that keep the same row count.
   * Absent in manifests written before this existed (the restore test then compares row counts only).
   */
  contentChecksums?: Record<string, string>;
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

async function snapshotFacts(client: Client, withChecksums: boolean): Promise<{ tables: Record<string, number>; checksums?: Record<string, string>; migrations: string[] }> {
  const names = (await client.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1`)).rows.map((r) => r.table_name);
  const tables: Record<string, number> = {};
  const checksums: Record<string, string> = {};
  for (const name of names) {
    // identifiers come from the catalog, quoted defensively
    const quoted = `"${name.replace(/"/g, '""')}"`;
    tables[name] = Number((await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${quoted}`)).rows[0]?.n ?? 0);
    // constant memory, independent of row order; the values themselves never leave the database
    if (withChecksums) checksums[name] = (await client.query<{ c: string }>(`SELECT coalesce(sum(hashtextextended(t::text, 0)::numeric), 0)::text AS c FROM ${quoted} t`)).rows[0]?.c ?? "0";
  }
  const migrations = tables._prisma_migrations !== undefined ? (await client.query<{ migration_name: string }>(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1`)).rows.map((r) => r.migration_name) : [];
  return { tables, ...(withChecksums ? { checksums } : {}), migrations };
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
  /** Record a per-table content fingerprint in the manifest (default true; costs one extra scan of every table). */
  contentChecksums?: boolean;
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
    facts = await snapshotFacts(client, options.contentChecksums !== false);
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
  const manifest: BackupManifest = { version: MANIFEST_VERSION, takenAt: takenAt.toISOString(), tables: facts.tables, ...(facts.checksums ? { contentChecksums: facts.checksums } : {}), migrations: facts.migrations, dumpSha256: sha256, encrypted: key !== null };
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
  /** Prefix of the throw-away database name (default `jm_restore_test_`); lowercase letters, digits, underscore. Lets parallel test runs tell their own databases apart. */
  databasePrefix?: string;
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

  const prefix = options.databasePrefix ?? "jm_restore_test_";
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(prefix)) throw new Error("restore_test_prefix_invalid");
  const dbName = `${prefix}${randomBytes(5).toString("hex")}`;
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
      const restored = await snapshotFacts(scratch, manifest.contentChecksums !== undefined);
      const problems: string[] = [];
      for (const [table, expected] of Object.entries(manifest.tables)) {
        const actual = restored.tables[table];
        if (actual === undefined) problems.push(`table ${table} is missing`);
        else if (actual !== expected) problems.push(`table ${table}: expected ${expected} rows, restored ${actual}`);
      }
      for (const table of Object.keys(restored.tables)) if (manifest.tables[table] === undefined) problems.push(`unexpected table ${table}`);
      if (manifest.contentChecksums) {
        for (const [table, expected] of Object.entries(manifest.contentChecksums)) if (restored.checksums?.[table] !== expected) problems.push(`table ${table}: content differs from the backup (same row count, different data)`);
      }
      if (JSON.stringify(restored.migrations) !== JSON.stringify(manifest.migrations)) problems.push("migration history differs from the manifest");
      const totalRows = Object.values(restored.tables).reduce((a, b) => a + b, 0);
      notes.push(`restored ${Object.keys(restored.tables).length} tables, ${totalRows} rows`);
      if (problems.length > 0) return { ok: false, notes: [...notes, ...problems] };
      return { ok: true, notes: [...notes, manifest.contentChecksums ? "all table row counts, table contents and the migration history match the manifest" : "all table row counts and the migration history match the manifest (older manifest: no content fingerprints)"] };
    } finally {
      await scratch.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => undefined);
    await admin.end();
    if (decrypted) await rm(decrypted, { force: true });
  }
}

// ---- offline verification (no database needed) ---------------------------------------------------------

export interface VerifyBackupOptions {
  file: string;
  manifestFile: string;
  /** Needed to open an encrypted backup. Without it only the checksum is checked (level "checksum"). */
  encryptionKey?: string;
  /** The backup is "stale" (not ok) when older than this many hours. Default 36. */
  maxAgeHours?: number;
  now?: Date;
}

export interface VerifyBackupResult {
  ok: boolean;
  /** "full": checksum + decryption + dump structure read; "checksum": only the file's integrity. Never "restored". */
  level: "full" | "checksum" | "failed";
  notes: string[];
}

/**
 * Cheap, safe check that can run every night on the backup host: it opens NO database connection and changes nothing except
 * a temporary decrypted copy that is always removed. It does NOT make a backup "operational" (only `restoreTest` does).
 */
export async function verifyBackup(options: VerifyBackupOptions): Promise<VerifyBackupResult> {
  const notes: string[] = [];
  const fail = (note: string): VerifyBackupResult => ({ ok: false, level: "failed", notes: [...notes, note] });
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(await readFile(options.manifestFile, "utf8")) as BackupManifest;
  } catch {
    return fail("manifest missing or not valid JSON");
  }
  if (manifest.version !== MANIFEST_VERSION || typeof manifest.dumpSha256 !== "string" || typeof manifest.tables !== "object" || manifest.tables === null || !Array.isArray(manifest.migrations)) return fail("manifest has an unexpected format");
  const tableCount = Object.keys(manifest.tables).length;
  if (tableCount === 0) return fail("manifest lists no tables");

  let size: number;
  try {
    size = (await stat(options.file)).size;
  } catch {
    return fail("backup file is missing");
  }
  if (size === 0) return fail("backup file is empty");
  if ((await sha256File(options.file)) !== manifest.dumpSha256) return fail("checksum does not match the manifest (corrupted or modified)");
  notes.push(`checksum matches (${size} bytes, ${tableCount} tables in manifest)`);

  const taken = Date.parse(manifest.takenAt);
  const now = (options.now ?? new Date()).getTime();
  const maxAgeMs = (options.maxAgeHours ?? 36) * 3600_000;
  if (!Number.isFinite(taken)) return fail("manifest has no valid backup time");
  if (now - taken > maxAgeMs) return fail(`backup is older than ${options.maxAgeHours ?? 36} hours`);
  notes.push("backup is recent");

  let dumpFile = options.file;
  let temp: string | null = null;
  try {
    if (manifest.encrypted) {
      if (!options.encryptionKey) return { ok: true, level: "checksum", notes: [...notes, "encrypted: no key given, so the content was not opened"] };
      temp = `${options.file}.verify.tmp`;
      try {
        await decryptFile(options.file, temp, parseBackupKey(options.encryptionKey));
      } catch (error) {
        return fail(`could not decrypt: ${error instanceof Error ? error.message : "error"}`);
      }
      dumpFile = temp;
      notes.push("decrypts with the key (authentication tag valid)");
    }
    let listing: { code: number; stderr: string };
    try {
      listing = await run("pg_restore", ["--list", dumpFile], {});
    } catch {
      return { ok: true, level: "checksum", notes: [...notes, "pg_restore is not installed here, so the dump structure was not read"] };
    }
    if (listing.code !== 0) return fail("pg_restore cannot read the dump structure");
    notes.push("dump structure is readable by pg_restore");
    return { ok: true, level: "full", notes };
  } finally {
    if (temp) await rm(temp, { force: true });
  }
}

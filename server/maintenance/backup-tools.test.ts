import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrations } from "../db/migrations";
import { decryptFile, encryptFile, parseBackupKey, pgEnv, pruneBackups, restoreTest, sha256File, takeBackup } from "./backup-tools";

let dir: string;
beforeAll(async () => void (dir = await mkdtemp(join(tmpdir(), "jm-backup-test-"))));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe("backup encryption", () => {
  it("round-trips, never stores plaintext, and detects a wrong key or tampering", async () => {
    const key = randomBytes(32);
    const plain = join(dir, "plain.bin");
    const secret = "رمز-بسیار-محرمانه-" + "x".repeat(200_000);
    await writeFile(plain, secret);
    const enc = join(dir, "plain.bin.enc");
    await encryptFile(plain, enc, key);
    expect((await readFile(enc)).includes(Buffer.from("محرمانه"))).toBe(false);
    const out = join(dir, "out.bin");
    await decryptFile(enc, out, key);
    expect(await readFile(out, "utf8")).toBe(secret);

    await expect(decryptFile(enc, join(dir, "bad1"), randomBytes(32))).rejects.toThrow();
    const tampered = Buffer.from(await readFile(enc));
    tampered[100] = (tampered[100] ?? 0) ^ 1;
    await writeFile(join(dir, "tampered.enc"), tampered);
    await expect(decryptFile(join(dir, "tampered.enc"), join(dir, "bad2"), key)).rejects.toThrow();
    await writeFile(join(dir, "short.enc"), "JMBK1");
    await expect(decryptFile(join(dir, "short.enc"), join(dir, "bad3"), key)).rejects.toThrow("too_short");
  });

  it("validates the key format", () => {
    expect(() => parseBackupKey(undefined)).toThrow("backup_key_invalid");
    expect(() => parseBackupKey("c2hvcnQ=")).toThrow("backup_key_invalid");
    expect(parseBackupKey(randomBytes(32).toString("base64"))).toHaveLength(32);
  });
});

describe("connection settings for child processes", () => {
  it("passes credentials through the environment, not arguments", () => {
    expect(pgEnv("postgresql://app:p%40ss@db.internal:5433/jaryan?sslmode=require")).toEqual({
      PGHOST: "db.internal", PGPORT: "5433", PGUSER: "app", PGPASSWORD: "p@ss", PGDATABASE: "jaryan", PGSSLMODE: "require",
    });
    expect(pgEnv("postgresql://app@h/jaryan", "scratch").PGDATABASE).toBe("scratch");
  });
});

describe("retention", () => {
  it("removes only old backup files", async () => {
    const d = await mkdtemp(join(tmpdir(), "jm-prune-"));
    const old = new Date(Date.now() - 40 * 86_400_000);
    await writeFile(join(d, "jaryan-db-old.dump.enc"), "x");
    await writeFile(join(d, "jaryan-db-old.manifest.json"), "{}");
    await writeFile(join(d, "jaryan-db-new.dump.enc"), "x");
    await writeFile(join(d, "unrelated.txt"), "x");
    await utimes(join(d, "jaryan-db-old.dump.enc"), old, old);
    await utimes(join(d, "jaryan-db-old.manifest.json"), old, old);
    expect(await pruneBackups(d, 30)).toBe(1);
    expect((await readdir(d)).sort()).toEqual(["jaryan-db-new.dump.enc", "unrelated.txt"]);
    await rm(d, { recursive: true, force: true });
  });
});

// Real pg_dump / pg_restore against a real PostgreSQL server: runs when TEST_DATABASE_URL is set (CI service container or local server).
const external = process.env.TEST_DATABASE_URL;
const haveTools = spawnSync("pg_dump", ["--version"]).status === 0 && spawnSync("pg_restore", ["--version"]).status === 0;

describe.skipIf(!external || !haveTools)("backup and restore test against a real PostgreSQL", () => {
  let sourceDb: string;
  let sourceUrl: string;
  let admin: Client;
  const key = randomBytes(32).toString("base64");

  beforeAll(async () => {
    admin = new Client({ connectionString: external });
    await admin.connect();
    sourceDb = `jm_backup_src_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${sourceDb}"`);
    const url = new URL(external as string);
    url.pathname = `/${sourceDb}`;
    sourceUrl = url.toString();
    const c = new Client({ connectionString: sourceUrl });
    await c.connect();
    for (const m of readMigrations()) await c.query(m.sql);
    await c.query(`CREATE TABLE IF NOT EXISTS _prisma_migrations (migration_name text, finished_at timestamptz)`);
    for (const m of readMigrations()) await c.query(`INSERT INTO _prisma_migrations VALUES ($1, now())`, [m.name]);
    await c.query(`INSERT INTO "Vendor" (id, slug, name, "updatedAt") VALUES ('v1', 'jaryan-ma', 'جریان ما', now())`);
    await c.end();
  }, 60_000);

  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${sourceDb}" WITH (FORCE)`);
    await admin.end();
  });

  it("takes an encrypted backup, restores it into a scratch database and verifies it", async () => {
    const backup = await takeBackup({ databaseUrl: sourceUrl, directory: dir, encryptionKey: key });
    expect(backup.encrypted).toBe(true);
    expect(backup.file.endsWith(".dump.enc")).toBe(true);
    expect(await readdir(dir)).not.toContain(backup.file.replace(/\.enc$/, "")); // no plaintext dump left behind
    expect(backup.manifest.tables.Vendor).toBe(1);
    expect(backup.sha256).toBe(await sha256File(backup.file));

    const result = await restoreTest({ file: backup.file, manifestFile: backup.manifestFile, scratchAdminUrl: external as string, encryptionKey: key });
    expect(result).toMatchObject({ ok: true });
    expect(result.notes.join(" ")).toContain("match the manifest");
    const left = await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'jm_restore_test_%'`);
    expect(left.rows).toEqual([]); // scratch database dropped
  }, 120_000);

  it("fails the restore test for a corrupted file, a wrong key and a manifest mismatch", async () => {
    const backup = await takeBackup({ databaseUrl: sourceUrl, directory: dir, encryptionKey: key });
    const wrongKey = await restoreTest({ file: backup.file, manifestFile: backup.manifestFile, scratchAdminUrl: external as string, encryptionKey: randomBytes(32).toString("base64") });
    expect(wrongKey.ok).toBe(false);

    const manifest = JSON.parse(await readFile(backup.manifestFile, "utf8"));
    manifest.tables.Vendor = 99;
    const badManifest = join(dir, "bad.manifest.json");
    await writeFile(badManifest, JSON.stringify(manifest));
    const mismatch = await restoreTest({ file: backup.file, manifestFile: badManifest, scratchAdminUrl: external as string, encryptionKey: key });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.notes.join(" ")).toContain("table Vendor: expected 99 rows, restored 1");

    const bytes = Buffer.from(await readFile(backup.file));
    bytes[bytes.length - 40] = (bytes[bytes.length - 40] ?? 0) ^ 0xff;
    const corrupt = join(dir, "corrupt.dump.enc");
    await writeFile(corrupt, bytes);
    const corrupted = await restoreTest({ file: corrupt, manifestFile: backup.manifestFile, scratchAdminUrl: external as string, encryptionKey: key });
    expect(corrupted).toMatchObject({ ok: false });
    expect(corrupted.notes.join(" ")).toContain("checksum");
    expect((await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE 'jm_restore_test_%'`)).rows).toEqual([]);
  }, 120_000);

  it("refuses to back up without an encryption key unless explicitly allowed", async () => {
    await expect(takeBackup({ databaseUrl: sourceUrl, directory: dir })).rejects.toThrow("backup_key_required");
  });

  it("reports pg_dump failures without leaving partial files", async () => {
    const before = (await readdir(dir)).length;
    await expect(takeBackup({ databaseUrl: sourceUrl.replace(sourceDb, "does_not_exist_db"), directory: dir, encryptionKey: key })).rejects.toThrow();
    expect((await readdir(dir)).length).toBe(before);
  });
});


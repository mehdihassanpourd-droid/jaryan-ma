import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client";
import { readMigrations } from "../db/migrations";
import { ensureDefaultVendor } from "../db/vendor";

/**
 * The whole drill, for real: the actual `ops` CLI takes an encrypted backup of a DISPOSABLE database, and the actual
 * scripts/maintenance/restore-drill.sh verifies it and restores it into a throw-away database, checking row counts, table
 * contents and migration history. Runs only against a disposable PostgreSQL (TEST_DATABASE_URL: the CI service container or a
 * local scratch server); it creates and drops its own databases and never reads DATABASE_URL from the environment.
 */
const external = process.env.TEST_DATABASE_URL;
const haveTools = spawnSync("pg_dump", ["--version"]).status === 0 && spawnSync("pg_restore", ["--version"]).status === 0;
const ROOT = join(import.meta.dirname, "..", "..");
const DRILL = join(ROOT, "scripts", "maintenance", "restore-drill.sh");

describe.skipIf(!external || !haveTools)("restore drill end to end (disposable PostgreSQL only)", () => {
  const key = randomBytes(32).toString("base64");
  let admin: Client;
  let sourceDb: string;
  let sourceUrl: string;
  let db: Db;
  let dir: string;
  let env: NodeJS.ProcessEnv;

  const ops = (...args: string[]) => spawnSync("npm", ["run", "--silent", "ops", "--", ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 120_000 });
  const drill = (extra: Record<string, string> = {}) => spawnSync("bash", [DRILL], { cwd: ROOT, env: { ...env, ...extra }, encoding: "utf8", timeout: 180_000 });
  // a prefix of our own, so other test files restoring into the same server at the same time cannot be mistaken for leftovers of this drill
  const prefix = `jm_drill_scratch_${randomBytes(3).toString("hex")}_`;
  const scratchLeft = async () => (await admin.query(`SELECT datname FROM pg_database WHERE datname LIKE $1`, [`${prefix}%`])).rows;

  beforeAll(async () => {
    admin = new Client({ connectionString: external });
    await admin.connect();
    sourceDb = `jm_drill_src_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${sourceDb}"`);
    const url = new URL(external as string);
    url.pathname = `/${sourceDb}`;
    sourceUrl = url.toString();
    const c = new Client({ connectionString: sourceUrl });
    await c.connect();
    for (const m of readMigrations()) await c.query(m.sql);
    await c.query(`CREATE TABLE IF NOT EXISTS _prisma_migrations (migration_name text, finished_at timestamptz, rolled_back_at timestamptz)`);
    for (const m of readMigrations()) await c.query(`INSERT INTO _prisma_migrations (migration_name, finished_at) VALUES ($1, now())`, [m.name]);
    await c.end();
    db = createDb(sourceUrl, { maxConnections: 2 });
    const vendorId = await ensureDefaultVendor(db);
    await db.product.create({ data: { vendorId, slug: "vase", name: "گلدان", status: "published", fulfillment: "stocked", priceToman: 100_000n, inventory: 4 } });
    dir = await mkdtemp(join(tmpdir(), "jm-drill-"));
    // Deliberately a minimal environment: no production variables can leak in from the developer's or CI's shell.
    env = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DATABASE_URL: sourceUrl, BACKUP_DIR: dir, BACKUP_ENCRYPTION_KEY: key, RESTORE_TEST_ADMIN_URL: external as string, RESTORE_TEST_DB_PREFIX: prefix, NODE_ENV: "development" };
  }, 90_000);

  afterAll(async () => {
    await db?.$disconnect();
    await admin?.query(`DROP DATABASE IF EXISTS "${sourceDb}" WITH (FORCE)`);
    await admin?.end();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("refuses to run when the scratch server is the source server (exit 64), and touches nothing", async () => {
    const r = drill();
    expect(r.status).toBe(64);
    expect(r.stderr).toContain("the scratch server is the production server");
    expect(await scratchLeft()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses every spelling of the same machine (localhost, 127.0.0.1, ::1)", async () => {
    const port = new URL(external as string).port || "5432";
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      const r = drill({ DATABASE_URL: `postgresql://u:p@${host}:${port}/x`, RESTORE_TEST_ADMIN_URL: `postgresql://u:p@127.0.0.1:${port}/postgres` });
      expect(r.status, host).toBe(64);
    }
    expect(drill({ RESTORE_TEST_ADMIN_URL: "" }).status).toBe(64);
    expect(drill({ BACKUP_DIR: join(dir, "missing") }).status).toBe(64);
  });

  it("backs up with the real CLI, then verifies and restores it; the restored data matches and the scratch database is dropped", async () => {
    const backup = ops("backup");
    expect(backup.status, backup.stderr).toBe(0);
    expect(await readdir(dir)).toEqual(expect.arrayContaining([expect.stringMatching(/\.dump\.enc$/), expect.stringMatching(/\.manifest\.json$/)]));
    const manifestName = (await readdir(dir)).find((f) => f.endsWith(".manifest.json")) as string;
    const manifest = JSON.parse(await readFile(join(dir, manifestName), "utf8"));
    expect(manifest.tables.products).toBe(1);
    expect(manifest.contentChecksums.products).toMatch(/^-?\d+$/);

    // ALLOW_SAME_SERVER only because this test server is disposable; the restore still goes into a new throw-away database.
    const r = drill({ ALLOW_SAME_SERVER: "yes" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(r.stdout).toContain("BACKUP VERIFIED (full)");
    expect(r.stdout).toContain("RESTORE TEST PASSED");
    expect(r.stdout).toContain("table contents");
    expect(await scratchLeft()).toEqual([]);

    const status = ops("backup-status");
    expect(JSON.parse(status.stdout).database).toMatchObject({ state: "operational", operational: true });
    // the source database was only read: still exactly what we seeded
    expect(await db.product.count()).toBe(1);
  }, 240_000);

  it("fails the drill (non-zero) for a damaged backup file, and records nothing as operational", async () => {
    const file = (await readdir(dir)).filter((f) => f.endsWith(".dump.enc")).sort().at(-1) as string;
    const bytes = Buffer.from(await readFile(join(dir, file)));
    bytes[bytes.length - 40] = (bytes[bytes.length - 40] ?? 0) ^ 0xff;
    await writeFile(join(dir, file), bytes);
    const r = drill({ ALLOW_SAME_SERVER: "yes" });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain("BACKUP VERIFICATION FAILED");
    expect(await scratchLeft()).toEqual([]);
  }, 240_000);
});

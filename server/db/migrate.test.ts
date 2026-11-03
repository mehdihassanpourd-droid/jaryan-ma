import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checksumOf, deployMigrations, MigrationError, migrationStatus, planMigrations, type AppliedRow } from "./migrate";
import { findMigrationsDir, readMigrations } from "./migrations";

const m = (name: string, sql: string) => ({ name, sql });
const row = (name: string, sql: string, over: Partial<AppliedRow> = {}): AppliedRow => ({ migration_name: name, checksum: checksumOf(sql), finished_at: new Date(), rolled_back_at: null, ...over });

describe("planMigrations (pure)", () => {
  const a = m("001_a", "CREATE TABLE a(id int);");
  const b = m("002_b", "CREATE TABLE b(id int);");

  it("lists pending migrations in file order", () => {
    expect(planMigrations([a, b], [row(a.name, a.sql)])).toMatchObject({ applied: ["001_a"], pending: ["002_b"], ok: true });
    expect(planMigrations([a, b], [])).toMatchObject({ pending: ["001_a", "002_b"] });
  });
  it("flags an applied migration whose file changed", () => {
    expect(planMigrations([a, b], [row(a.name, "CREATE TABLE a(id bigint);")])).toMatchObject({ modified: ["001_a"], ok: false });
  });
  it("flags a migration that was started and never finished, but ignores rolled-back ones", () => {
    expect(planMigrations([a], [row(a.name, a.sql, { finished_at: null })])).toMatchObject({ unfinished: ["001_a"], ok: false });
    expect(planMigrations([a], [row(a.name, a.sql, { finished_at: null, rolled_back_at: new Date() })])).toMatchObject({ unfinished: [], pending: ["001_a"], ok: true });
  });
  it("reports a database that is newer than the release without failing", () => {
    expect(planMigrations([a], [row(a.name, a.sql), row("003_future", "x")])).toMatchObject({ unknownToRelease: ["003_future"], ok: true });
  });
});

describe("migration files", () => {
  it("are found from source and from the bundled locations, and MIGRATIONS_DIR overrides", () => {
    const repo = findMigrationsDir(`${process.cwd()}/server/db`, {});
    expect(repo.endsWith("prisma/migrations/")).toBe(true);
    expect(findMigrationsDir(`${process.cwd()}/dist/server/cli`, {})).toBeTruthy();
    expect(findMigrationsDir("/x", { MIGRATIONS_DIR: "/srv/m" })).toBe("/srv/m/");
    expect(readMigrations(repo).length).toBeGreaterThan(5);
  });
});

const external = process.env.TEST_DATABASE_URL;
describe.skipIf(!external)("deployMigrations against a real PostgreSQL", () => {
  let admin: Client;
  let dbName: string;
  let url: string;
  const open = async () => {
    const c = new Client({ connectionString: url });
    await c.connect();
    return c;
  };
  beforeAll(async () => {
    admin = new Client({ connectionString: external });
    await admin.connect();
    dbName = `jm_migrate_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const u = new URL(external as string);
    u.pathname = `/${dbName}`;
    url = u.toString();
  });
  afterAll(async () => {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it("applies every real migration to an empty database, is idempotent, and matches the Prisma bookkeeping format", async () => {
    const files = readMigrations();
    const c = await open();
    try {
      expect((await migrationStatus(c, files)).pending).toHaveLength(files.length); // read-only: does not even create the table
      expect((await c.query(`SELECT to_regclass('_prisma_migrations')::text AS t`)).rows[0].t).toBeNull();
      const dry = await deployMigrations(c, files, { dryRun: true });
      expect(dry.appliedNow).toEqual([]);
      const first = await deployMigrations(c, files);
      expect(first.appliedNow).toEqual(files.map((f) => f.name));
      expect(first.status).toMatchObject({ pending: [], ok: true });
      const again = await deployMigrations(c, files);
      expect(again.appliedNow).toEqual([]);
      const r = await c.query(`SELECT migration_name, checksum, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name`);
      expect(r.rows).toHaveLength(files.length);
      expect(r.rows[0].checksum).toBe(checksumOf(files[0]?.sql ?? ""));
      expect(r.rows.every((x: { finished_at: Date | null }) => x.finished_at !== null)).toBe(true);
    } finally {
      await c.end();
    }
  }, 60_000);

  it("a failing migration is rolled back completely and leaves no bookkeeping row", async () => {
    const files = [...readMigrations(), m("99999999999999_broken", "CREATE TABLE jm_half_done(id int); SELECT 1/0;")];
    const c = await open();
    try {
      const error = (await deployMigrations(c, files).catch((e: unknown) => e)) as MigrationError;
      expect(error).toBeInstanceOf(MigrationError);
      expect(error.code).toBe("failed");
      expect(error.migration).toBe("99999999999999_broken");
      expect((await c.query(`SELECT to_regclass('jm_half_done')::text AS t`)).rows[0].t).toBeNull();
      expect((await c.query(`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '99999999999999_broken'`)).rows[0].n).toBe(0);
      expect((await migrationStatus(c, readMigrations())).ok).toBe(true);
    } finally {
      await c.end();
    }
  }, 60_000);

  it("refuses a modified applied migration and an unfinished one, and never touches them", async () => {
    const files = readMigrations();
    const c = await open();
    try {
      const changed = files.map((f, i) => (i === 0 ? { ...f, sql: `${f.sql}\n-- edited` } : f));
      expect(((await deployMigrations(c, changed).catch((e: unknown) => e)) as MigrationError).code).toBe("modified");
      await c.query(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at) VALUES ('stuck', 'x', '77777777777777_stuck', now())`);
      expect(((await deployMigrations(c, files).catch((e: unknown) => e)) as MigrationError).code).toBe("unfinished");
      await c.query(`DELETE FROM _prisma_migrations WHERE id = 'stuck'`);
    } finally {
      await c.end();
    }
  }, 60_000);

  it("holds an advisory lock: a second run at the same time is refused", async () => {
    const files = readMigrations();
    const holder = await open();
    const second = await open();
    try {
      await holder.query(`SELECT pg_advisory_lock(7104220411)`);
      expect(((await deployMigrations(second, files).catch((e: unknown) => e)) as MigrationError).code).toBe("locked");
    } finally {
      await holder.end();
      await second.end();
    }
  }, 60_000);
});

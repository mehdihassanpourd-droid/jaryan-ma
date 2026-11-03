import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type Db } from "./client";
import { deployMigrations } from "./migrate";
import { readMigrations } from "./migrations";
import { checkMigrations } from "../runtime";

const external = process.env.TEST_DATABASE_URL;

describe.skipIf(!external)("checkMigrations: the health view of a database against the running release", () => {
  let admin: Client;
  let dbName: string;
  let url: string;
  let db: Db;
  let c: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: external });
    await admin.connect();
    dbName = `jm_schemahealth_${randomBytes(4).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${dbName}"`);
    const u = new URL(external as string);
    u.pathname = `/${dbName}`;
    url = u.toString();
    c = new Client({ connectionString: url });
    await c.connect();
    await deployMigrations(c, readMigrations());
    db = createDb(url, { maxConnections: 2 });
  }, 60_000);

  afterAll(async () => {
    await db?.$disconnect();
    await c?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.end();
  });

  it("compatible: ok", async () => {
    expect(await checkMigrations(db, true)).toMatchObject({ status: "ok", message: "all migrations applied" });
  });

  it("newer unknown migrations: an explicit warn (degraded), with a count and never a name", async () => {
    await c.query(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('n1', 'x', '29990101000000_secret_future_name', now(), now(), 1)`);
    const r = await checkMigrations(db, true);
    expect(r.status).toBe("warn");
    expect(r.message).toContain("schema ahead");
    expect(r.message).toContain("1 applied migration");
    expect(r.message).toContain("not necessarily incompatible");
    expect(r.message).not.toContain("secret_future_name");
    await c.query(`DELETE FROM _prisma_migrations WHERE id = 'n1'`);
    expect((await checkMigrations(db, true)).status).toBe("ok");
  });

  it("missing migrations: fail (the release needs something the database does not have)", async () => {
    const last = readMigrations().at(-1)?.name ?? "";
    const saved = (await c.query(`SELECT * FROM _prisma_migrations WHERE migration_name = $1`, [last])).rows[0];
    await c.query(`DELETE FROM _prisma_migrations WHERE migration_name = $1`, [last]);
    expect(await checkMigrations(db, true)).toMatchObject({ status: "fail", message: "1 migration(s) not applied" });
    await c.query(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ($1,$2,$3,$4,$5,$6)`, [saved.id, saved.checksum, saved.migration_name, saved.started_at, saved.finished_at, saved.applied_steps_count]);
  });

  it("an unfinished migration: fail; a modified applied migration: warn", async () => {
    await c.query(`INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at) VALUES ('u1', 'x', '77777777777777_stuck', now())`);
    expect(await checkMigrations(db, true)).toMatchObject({ status: "fail", message: "a migration started but did not finish" });
    await c.query(`DELETE FROM _prisma_migrations WHERE id = 'u1'`);
    const first = readMigrations()[0]?.name ?? "";
    const old = (await c.query(`SELECT checksum FROM _prisma_migrations WHERE migration_name = $1`, [first])).rows[0].checksum;
    await c.query(`UPDATE _prisma_migrations SET checksum = 'tampered' WHERE migration_name = $1`, [first]);
    expect(await checkMigrations(db, true)).toMatchObject({ status: "warn" });
    await c.query(`UPDATE _prisma_migrations SET checksum = $2 WHERE migration_name = $1`, [first, old]);
    expect((await checkMigrations(db, true)).status).toBe("ok");
  });
});

import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { createDb, type Db } from "./client";
import { startEmbeddedPostgres } from "./embedded";
import { readMigrations } from "./migrations";

export interface TestDatabase {
  db: Db;
  /** Removes all rows (keeps the schema) so each test starts clean. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

const TABLES = [
  '"audit_log"',
  '"admin_sessions"',
  '"admin_users"',
  '"product_variants"',
  '"product_images"',
  '"products"',
  '"categories"',
  '"VendorMember"',
  '"Vendor"',
];

/**
 * Database for tests. By default an in-process embedded PostgreSQL (no services, runs anywhere,
 * including CI). Set TEST_DATABASE_URL to run the very same tests against a real PostgreSQL server:
 * each test file then gets its own throw-away schema.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const external = process.env.TEST_DATABASE_URL;
  if (!external) {
    const embedded = await startEmbeddedPostgres();
    const db = createDb(embedded.url, { maxConnections: 4 });
    return finish(db, "public", async () => {
      await db.$disconnect();
      await embedded.stop();
    });
  }

  const schema = `test_${randomBytes(6).toString("hex")}`;
  const admin = new Client({ connectionString: external });
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  for (const migration of readMigrations()) await admin.query(migration.sql);
  const db = createDb(external, { maxConnections: 4, schema });
  return finish(db, schema, async () => {
    await db.$disconnect();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  });
}

function finish(db: Db, schema: string, close: () => Promise<void>): TestDatabase {
  // Raw SQL is not covered by Prisma's schema option, so qualify the tables explicitly.
  const qualified = TABLES.map((t) => `"${schema}".${t}`).join(", ");
  return {
    db,
    async reset() {
      await db.$executeRawUnsafe(`TRUNCATE ${qualified} CASCADE`);
    },
    close,
  };
}

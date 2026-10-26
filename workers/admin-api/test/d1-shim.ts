import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { D1DatabaseLike, D1PreparedStatementLike, D1ResultLike, R2BucketLike } from "../src/d1";

// `node:sqlite` is loaded through createRequire because Vite cannot resolve this
// prefix-only builtin. Node's SQLite is the same engine D1 runs.
const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as typeof import("node:sqlite");

type SqlValue = string | number | bigint | null | Uint8Array;
const isRead = (sql: string) => /^\s*(select|with|pragma)\b/i.test(sql);

export const MIGRATION_SQL = readFileSync(fileURLToPath(new URL("../migrations/0001_init.sql", import.meta.url)), "utf8");

/** In-memory SQLite exposing the D1 surface the Worker uses. Applies the real migration. */
export function createTestDb(): D1DatabaseLike {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(MIGRATION_SQL);

  const exec = (sql: string, params: SqlValue[]): D1ResultLike => {
    const stmt = db.prepare(sql);
    if (isRead(sql)) return { results: stmt.all(...params) as unknown[], meta: { changes: 0 } };
    const r = stmt.run(...params);
    return { results: [], meta: { changes: Number(r.changes) } };
  };

  class Statement implements D1PreparedStatementLike {
    constructor(
      readonly sql: string,
      readonly params: SqlValue[] = [],
    ) {}
    bind(...values: unknown[]) {
      return new Statement(this.sql, values.map((v) => (v === undefined ? null : (v as SqlValue))));
    }
    async first<T>() {
      return ((exec(this.sql, this.params).results ?? [])[0] as T | undefined) ?? null;
    }
    async all<T>() {
      return { results: (exec(this.sql, this.params).results ?? []) as T[] };
    }
    async run() {
      return exec(this.sql, this.params);
    }
  }

  return {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = statements.map((s) => {
          const st = s as Statement;
          return exec(st.sql, st.params);
        });
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** Direct SQL access for assertions and fixtures. */
export async function sql<T = Record<string, unknown>>(db: D1DatabaseLike, query: string, ...params: unknown[]): Promise<T[]> {
  return (await db.prepare(query).bind(...params).all<T>()).results;
}

export class FakeBucket implements R2BucketLike {
  objects = new Map<string, { body: string | Uint8Array; contentType?: string; cacheControl?: string }>();
  async put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }) {
    const body = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    this.objects.set(key, { body, contentType: options?.httpMetadata?.contentType, cacheControl: options?.httpMetadata?.cacheControl });
  }
  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  json(key: string): unknown {
    const o = this.objects.get(key);
    return o ? JSON.parse(String(o.body)) : undefined;
  }
}

export async function seedAdmin(db: D1DatabaseLike, email: string, role: "owner" | "editor" | "viewer", disabled = 0) {
  await db.prepare("INSERT INTO admins (email, role, disabled, created_at) VALUES (?,?,?,?)").bind(email, role, disabled, "2026-01-01T00:00:00.000Z").run();
}

export async function seedCategory(db: D1DatabaseLike, id: string, slug: string, name: string) {
  await db.prepare("INSERT INTO categories (id, slug, name, position, created_at) VALUES (?,?,?,0,?)").bind(id, slug, name, "2026-01-01T00:00:00.000Z").run();
}

/**
 * Minimal structural types for Cloudflare D1 and R2. The real bindings satisfy
 * these, and tests substitute an in-memory SQLite database and fake bucket, so the
 * code is testable without any cloud credentials.
 */
export interface D1ResultLike {
  results?: unknown[];
  meta?: { changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<D1ResultLike>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  /** Runs all statements in one transaction (one query for D1's per-invocation limit). */
  batch(statements: D1PreparedStatementLike[]): Promise<D1ResultLike[]>;
}

export interface R2BucketLike {
  put(
    key: string,
    value: string | ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}

import { z } from "zod";

/** Raised for missing/invalid settings. Messages name the variable, never its value. */
export class ConfigError extends Error {
  constructor(public problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
  }
}

const bool = (fallback?: boolean) =>
  z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true"));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1).optional(),
  STORAGE_DRIVER: z.enum(["s3", "local"]).optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  PUBLIC_MEDIA_URL: z.string().url().optional(),
  APP_ENCRYPTION_KEY: z.string().optional(),
  ADMIN_ORIGINS: z.string().optional(),
  COOKIE_SECURE: bool(),
  TRUST_PROXY: bool(false),
  IMPORT_CHUNK_MAX: z.coerce.number().int().min(1).max(200).default(50),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  REQUIRE_TOTP: bool(),
  SCRYPT_LOG_N: z.coerce.number().int().min(10).max(20).default(17),
  DEV_DATA_DIR: z.string().default(".data"),
  DEV_ADMIN_EMAIL: z.string().optional(),
  DEV_ADMIN_PASSWORD: z.string().optional(),
});

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface Config {
  production: boolean;
  host: string;
  port: number;
  /** Absent in development: an embedded PostgreSQL is started instead. */
  databaseUrl: string | null;
  storage: { driver: "s3"; s3: S3Config } | { driver: "local" };
  publicMediaUrl: string | null;
  /** Base64 key, or null in development (a key file is generated). */
  encryptionKey: string | null;
  adminOrigins: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  importChunkMax: number;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  requireTotp: boolean;
  scryptLogN: number;
  devDataDir: string;
  devAdmin: { email: string; password: string } | null;
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".") || "environment"}: ${i.message}`));
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";
  const problems: string[] = [];
  const need = (name: string, value: unknown) => {
    if (!value) problems.push(`${name} is required in production`);
  };

  if (production) {
    need("DATABASE_URL", e.DATABASE_URL);
    need("PUBLIC_MEDIA_URL", e.PUBLIC_MEDIA_URL);
    need("APP_ENCRYPTION_KEY", e.APP_ENCRYPTION_KEY);
    need("ADMIN_ORIGINS", e.ADMIN_ORIGINS);
    if (e.STORAGE_DRIVER !== "s3") problems.push("STORAGE_DRIVER must be \"s3\" in production (local disk storage is for development only)");
    if (e.STORAGE_DRIVER === "s3") {
      need("S3_ENDPOINT", e.S3_ENDPOINT);
      need("S3_BUCKET", e.S3_BUCKET);
      need("S3_ACCESS_KEY_ID", e.S3_ACCESS_KEY_ID);
      need("S3_SECRET_ACCESS_KEY", e.S3_SECRET_ACCESS_KEY);
    }
    if (e.REQUIRE_TOTP === false) problems.push("REQUIRE_TOTP=false is not allowed in production");
    if (e.COOKIE_SECURE === false) problems.push("COOKIE_SECURE=false is not allowed in production");
    if (e.DEV_ADMIN_EMAIL || e.DEV_ADMIN_PASSWORD) problems.push("DEV_ADMIN_* must not be set in production (create administrators with the admin CLI)");
    if (e.DATABASE_URL?.startsWith("pglite")) problems.push("DATABASE_URL must point to a PostgreSQL server in production");
  }
  if (e.APP_ENCRYPTION_KEY && Buffer.from(e.APP_ENCRYPTION_KEY, "base64").length !== 32) {
    problems.push("APP_ENCRYPTION_KEY must be 32 random bytes, base64-encoded (generate with: openssl rand -base64 32)");
  }
  if (e.DEV_ADMIN_EMAIL && !e.DEV_ADMIN_PASSWORD) problems.push("DEV_ADMIN_PASSWORD is required with DEV_ADMIN_EMAIL");
  if (problems.length > 0) throw new ConfigError(problems);

  const driver = e.STORAGE_DRIVER ?? "local";
  const port = e.PORT;
  const devOrigins = `http://127.0.0.1:${port},http://localhost:${port}`;
  return {
    production,
    host: e.HOST,
    port,
    databaseUrl: e.DATABASE_URL ?? null,
    storage:
      driver === "s3"
        ? {
            driver: "s3",
            s3: {
              endpoint: e.S3_ENDPOINT ?? "",
              region: e.S3_REGION,
              bucket: e.S3_BUCKET ?? "",
              accessKeyId: e.S3_ACCESS_KEY_ID ?? "",
              secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "",
              forcePathStyle: e.S3_FORCE_PATH_STYLE ?? true,
            },
          }
        : { driver: "local" },
    publicMediaUrl: e.PUBLIC_MEDIA_URL ?? (production ? null : `http://127.0.0.1:${port}/media`),
    encryptionKey: e.APP_ENCRYPTION_KEY ?? null,
    adminOrigins: e.ADMIN_ORIGINS ?? (production ? "" : devOrigins),
    cookieSecure: e.COOKIE_SECURE ?? production,
    trustProxy: e.TRUST_PROXY ?? false,
    importChunkMax: e.IMPORT_CHUNK_MAX,
    sessionIdleMinutes: e.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: e.SESSION_ABSOLUTE_HOURS,
    requireTotp: e.REQUIRE_TOTP ?? production,
    scryptLogN: e.SCRYPT_LOG_N,
    devDataDir: e.DEV_DATA_DIR,
    devAdmin: !production && e.DEV_ADMIN_EMAIL && e.DEV_ADMIN_PASSWORD ? { email: e.DEV_ADMIN_EMAIL, password: e.DEV_ADMIN_PASSWORD } : null,
  };
}

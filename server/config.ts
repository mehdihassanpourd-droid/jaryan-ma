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
  /** Development only: hosts ending in these suffixes are accepted as the SAME origin (see originAllowed), e.g. ".app.github.dev". */
  ADMIN_ORIGIN_HOST_SUFFIXES: z.string().optional(),
  /** Development only: the forwarder (GitHub Codespaces) rewrites Origin/Host to http://localhost:<port>; accept exactly that. Refused in production. */
  ADMIN_ACCEPT_REWRITTEN_ORIGIN: bool(false),
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
  /** Development only: create the FIRST administrator (password + mandatory TOTP) from the browser. Refused in production. */
  FIRST_RUN_SETUP: bool(false),
  /** Short git commit the server runs (set by the Codespaces scripts); shown on the sign-in page in development only. */
  APP_COMMIT: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  // ---- customers, SMS, support, maintenance
  CUSTOMER_ACCOUNTS_ENABLED: bool(),
  /** Storefront origin(s) allowed to call the customer API with credentials. */
  CUSTOMER_ORIGINS: z.string().optional(),
  SMS_PROVIDER: z.enum(["disabled", "console", "http"]).optional(),
  SMS_HTTP_URL: z.string().url().optional(),
  /** Value of the Authorization header (or similar) for the gateway. A secret: environment only. */
  SMS_HTTP_AUTH_HEADER: z.string().optional(),
  SMS_HTTP_AUTH_HEADER_NAME: z.string().default("authorization"),
  /** JSON body with {{to}} and {{text}} placeholders. */
  SMS_HTTP_BODY_TEMPLATE: z.string().optional(),
  SMS_HTTP_ID_FIELD: z.string().optional(),
  /** Hard ceiling of verification SMS per 24 h for the whole site (cost protection). */
  SMS_DAILY_LIMIT: z.coerce.number().int().min(1).max(100_000).default(300),
  RELEASE: z.string().max(64).optional(),
  SCHEDULER_ENABLED: bool(true),
  /** Built admin PWA (npm run admin:build). Served at /admin/ when the directory exists. */
  ADMIN_UI_DIR: z.string().default("dist/admin"),
  ADMIN_UI_ENABLED: bool(true),
});

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface SmsConfig {
  provider: "disabled" | "console" | "http";
  http: { url: string; authHeaderName: string; authHeader: string | null; bodyTemplate: string; idField: string | null } | null;
  dailyLimit: number;
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
  /** Development only (empty in production): see ADMIN_ORIGIN_HOST_SUFFIXES. */
  adminOriginHostSuffixes: string[];
  /** Development only (false in production): accept the loopback origin of this server own port; see OriginPolicy. */
  adminAcceptRewrittenOrigin: boolean;
  cookieSecure: boolean;
  trustProxy: boolean;
  importChunkMax: number;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  requireTotp: boolean;
  scryptLogN: number;
  devDataDir: string;
  devAdmin: { email: string; password: string } | null;
  /** Browser-based creation of the first administrator; never true in production. */
  firstRunSetup: boolean;
  /** Commit shown in development (never exposed in production). */
  appCommit: string | null;
  customerAccountsEnabled: boolean;
  customerOrigins: string;
  sms: SmsConfig;
  release: string | null;
  schedulerEnabled: boolean;
  adminUiDir: string | null;
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
    if (e.ADMIN_ORIGIN_HOST_SUFFIXES) problems.push("ADMIN_ORIGIN_HOST_SUFFIXES is development-only and not allowed in production (list the exact origin in ADMIN_ORIGINS)");
    if (e.ADMIN_ACCEPT_REWRITTEN_ORIGIN) problems.push("ADMIN_ACCEPT_REWRITTEN_ORIGIN is development-only and not allowed in production (list the exact origin in ADMIN_ORIGINS)");
    if (e.FIRST_RUN_SETUP) problems.push("FIRST_RUN_SETUP is development-only and not allowed in production (create administrators with the admin CLI)");
    if (e.DATABASE_URL?.startsWith("pglite")) problems.push("DATABASE_URL must point to a PostgreSQL server in production");
  }
  const suffixes = (e.ADMIN_ORIGIN_HOST_SUFFIXES ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
  // Each suffix must look like ".example.dev": a leading dot and at least two labels (never a bare TLD such as ".dev").
  if (suffixes.some((v) => !/^\.[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v))) {
    problems.push("ADMIN_ORIGIN_HOST_SUFFIXES must be a comma-separated list of suffixes like .app.github.dev (leading dot, at least two labels)");
  }
  const accounts = e.CUSTOMER_ACCOUNTS_ENABLED ?? !production;
  const smsProvider = e.SMS_PROVIDER ?? (production ? "disabled" : "console");
  if (production && smsProvider === "console") problems.push("SMS_PROVIDER=console prints sign-in codes to the log and is not allowed in production");
  if (smsProvider === "http") {
    need("SMS_HTTP_URL", e.SMS_HTTP_URL);
    need("SMS_HTTP_BODY_TEMPLATE", e.SMS_HTTP_BODY_TEMPLATE);
    if (e.SMS_HTTP_BODY_TEMPLATE && (!e.SMS_HTTP_BODY_TEMPLATE.includes("{{to}}") || !e.SMS_HTTP_BODY_TEMPLATE.includes("{{text}}"))) {
      problems.push("SMS_HTTP_BODY_TEMPLATE must contain {{to}} and {{text}}");
    }
    if (e.SMS_HTTP_BODY_TEMPLATE) {
      try {
        JSON.parse(e.SMS_HTTP_BODY_TEMPLATE.replace(/\{\{(to|text)\}\}/g, "x"));
      } catch {
        problems.push("SMS_HTTP_BODY_TEMPLATE must be valid JSON once the placeholders are filled in");
      }
    }
    if (e.SMS_HTTP_URL && production && !e.SMS_HTTP_URL.startsWith("https://")) problems.push("SMS_HTTP_URL must use https in production");
  }
  if (production && accounts) {
    need("CUSTOMER_ORIGINS", e.CUSTOMER_ORIGINS);
    if (smsProvider !== "http") problems.push("CUSTOMER_ACCOUNTS_ENABLED=true needs a real SMS gateway (SMS_PROVIDER=http); customers could not receive codes otherwise");
  }
  if (e.CUSTOMER_ORIGINS && e.CUSTOMER_ORIGINS.split(",").some((o) => o.includes("*") || (production && !o.trim().startsWith("https://")))) {
    problems.push("CUSTOMER_ORIGINS must list explicit origins (https:// in production, no wildcards)");
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
    adminOriginHostSuffixes: production ? [] : suffixes,
    adminAcceptRewrittenOrigin: !production && e.ADMIN_ACCEPT_REWRITTEN_ORIGIN === true,
    cookieSecure: e.COOKIE_SECURE ?? production,
    trustProxy: e.TRUST_PROXY ?? false,
    importChunkMax: e.IMPORT_CHUNK_MAX,
    sessionIdleMinutes: e.SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: e.SESSION_ABSOLUTE_HOURS,
    requireTotp: e.REQUIRE_TOTP ?? production,
    scryptLogN: e.SCRYPT_LOG_N,
    devDataDir: e.DEV_DATA_DIR,
    customerAccountsEnabled: accounts,
    customerOrigins: e.CUSTOMER_ORIGINS ?? (production ? "" : "http://127.0.0.1:3000,http://localhost:3000"),
    sms: {
      provider: smsProvider,
      http:
        smsProvider === "http" && e.SMS_HTTP_URL && e.SMS_HTTP_BODY_TEMPLATE
          ? { url: e.SMS_HTTP_URL, authHeaderName: e.SMS_HTTP_AUTH_HEADER_NAME, authHeader: e.SMS_HTTP_AUTH_HEADER ?? null, bodyTemplate: e.SMS_HTTP_BODY_TEMPLATE, idField: e.SMS_HTTP_ID_FIELD ?? null }
          : null,
      dailyLimit: e.SMS_DAILY_LIMIT,
    },
    release: e.RELEASE ?? null,
    schedulerEnabled: e.SCHEDULER_ENABLED ?? true,
    adminUiDir: (e.ADMIN_UI_ENABLED ?? true) ? e.ADMIN_UI_DIR : null,
    firstRunSetup: !production && e.FIRST_RUN_SETUP === true,
    appCommit: e.APP_COMMIT ?? null,
    devAdmin: !production && e.DEV_ADMIN_EMAIL && e.DEV_ADMIN_PASSWORD ? { email: e.DEV_ADMIN_EMAIL, password: e.DEV_ADMIN_PASSWORD } : null,
  };
}

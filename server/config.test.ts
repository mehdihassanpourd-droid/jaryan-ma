import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const key = randomBytes(32).toString("base64");
const prod = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:pw@db.internal:5432/jaryan",
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://s3.internal.example",
  S3_BUCKET: "jaryan-media",
  S3_ACCESS_KEY_ID: "AKIATESTONLY",
  S3_SECRET_ACCESS_KEY: "test-only-secret",
  PUBLIC_MEDIA_URL: "https://media.example.ir",
  APP_ENCRYPTION_KEY: key,
  ADMIN_ORIGINS: "https://admin.example.ir",
};

const problems = (env: Record<string, string>) => {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    return (error as ConfigError).problems;
  }
};

describe("development defaults (no external services)", () => {
  it("starts with embedded PostgreSQL, local storage and local origins", () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      production: false,
      databaseUrl: null,
      storage: { driver: "local" },
      publicMediaUrl: "http://127.0.0.1:3001/media",
      adminOrigins: "http://127.0.0.1:3001,http://localhost:3001",
      cookieSecure: false,
      requireTotp: false,
      host: "127.0.0.1",
    });
  });

  it("accepts a development admin bootstrap, but never in production", () => {
    expect(loadConfig({ DEV_ADMIN_EMAIL: "dev@example.test", DEV_ADMIN_PASSWORD: "x" }).devAdmin).toEqual({ email: "dev@example.test", password: "x" });
    expect(problems({ ...prod, DEV_ADMIN_EMAIL: "dev@example.test", DEV_ADMIN_PASSWORD: "x" }).join()).toContain("DEV_ADMIN_*");
    expect(problems({ DEV_ADMIN_EMAIL: "dev@example.test" }).join()).toContain("DEV_ADMIN_PASSWORD");
  });
});

describe("production", () => {
  it("accepts a complete configuration and applies secure defaults", () => {
    const c = loadConfig(prod);
    expect(c).toMatchObject({ production: true, cookieSecure: true, requireTotp: true, trustProxy: false, devAdmin: null });
    expect(c.storage).toMatchObject({ driver: "s3", s3: { bucket: "jaryan-media", forcePathStyle: true } });
  });

  it("lists every missing setting at once", () => {
    const list = problems({ NODE_ENV: "production" });
    for (const name of ["DATABASE_URL", "PUBLIC_MEDIA_URL", "APP_ENCRYPTION_KEY", "ADMIN_ORIGINS", "STORAGE_DRIVER"]) {
      expect(list.join("\n"), name).toContain(name);
    }
  });

  it("requires the S3 settings when S3 storage is chosen and refuses local storage", () => {
    expect(problems({ ...prod, S3_BUCKET: "" }).join()).toContain("S3_BUCKET");
    expect(problems({ ...prod, STORAGE_DRIVER: "local" }).join()).toContain("development only");
  });

  it("refuses insecure overrides", () => {
    expect(problems({ ...prod, REQUIRE_TOTP: "false" }).join()).toContain("REQUIRE_TOTP");
    expect(problems({ ...prod, COOKIE_SECURE: "false" }).join()).toContain("COOKIE_SECURE");
  });

  it("validates the encryption key length", () => {
    expect(problems({ ...prod, APP_ENCRYPTION_KEY: "dG9vLXNob3J0" }).join()).toContain("32 random bytes");
  });

  it("never puts secret values in error messages", () => {
    const text = new ConfigError(problems({ ...prod, APP_ENCRYPTION_KEY: "c2VjcmV0LXZhbHVl", S3_BUCKET: "" })).message;
    expect(text).not.toContain("c2VjcmV0LXZhbHVl");
    expect(text).not.toContain("test-only-secret");
    expect(text).not.toContain("pw@db.internal");
  });
});

describe("validation", () => {
  it("rejects malformed values", () => {
    expect(problems({ PORT: "99999" }).join()).toContain("PORT");
    expect(problems({ S3_ENDPOINT: "not a url" }).join()).toContain("S3_ENDPOINT");
    expect(problems({ TRUST_PROXY: "yes" }).join()).toContain("TRUST_PROXY");
    expect(problems({ SCRYPT_LOG_N: "5" }).join()).toContain("SCRYPT_LOG_N");
  });
});

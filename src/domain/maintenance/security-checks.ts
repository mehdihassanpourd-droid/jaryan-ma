import type { CheckResult } from "./health";

/** Facts about the running configuration, collected by the server (never raw secret values). */
export interface SecurityFacts {
  production: boolean;
  encryptionKeyConfigured: boolean;
  cookieSecure: boolean;
  requireTotp: boolean;
  adminOrigins: string[];
  storageDriver: "s3" | "local";
  databaseIsEmbedded: boolean;
  trustProxy: boolean;
  customerAccountsEnabled: boolean;
  smsProvider: "disabled" | "console" | "memory" | "http";
  publicMediaUrl: string | null;
  devAdminConfigured: boolean;
}

/**
 * Pure configuration review. "fail" = unsafe for production, "warn" = worth fixing, "ok" = fine.
 * Outside production most findings are informational so development stays easy.
 */
export function securityChecks(f: SecurityFacts): CheckResult[] {
  const results: CheckResult[] = [];
  const add = (name: string, ok: boolean, message: string, severity: "fail" | "warn" = "fail") =>
    results.push({ name: `security.${name}`, status: ok ? "ok" : f.production ? severity : "warn", message });

  add("encryption_key", f.encryptionKeyConfigured, f.encryptionKeyConfigured ? "encryption key configured" : "APP_ENCRYPTION_KEY is not configured");
  add("cookies", f.cookieSecure, f.cookieSecure ? "session cookies are Secure" : "session cookies are not marked Secure");
  add("totp", f.requireTotp, f.requireTotp ? "two-factor authentication is required for administrators" : "two-factor authentication is not required");
  const badOrigins = f.adminOrigins.filter((o) => !/^https:\/\/[^*\s]+$/.test(o));
  add(
    "admin_origins",
    f.adminOrigins.length > 0 && badOrigins.length === 0,
    f.adminOrigins.length === 0 ? "no admin origin is allowed" : badOrigins.length === 0 ? "admin origins are HTTPS and explicit" : "an admin origin is not HTTPS or contains a wildcard",
  );
  add("storage", f.storageDriver === "s3", f.storageDriver === "s3" ? "media uses S3-compatible storage" : "media uses local disk (development only)");
  add("database", !f.databaseIsEmbedded, f.databaseIsEmbedded ? "embedded development database in use" : "PostgreSQL server in use");
  add("dev_admin", !f.devAdminConfigured, f.devAdminConfigured ? "development administrator account is configured" : "no development administrator account configured");
  const mediaOk = f.publicMediaUrl === null || f.publicMediaUrl.startsWith("https://");
  add("media_url", mediaOk, mediaOk ? "public media URL uses HTTPS" : "public media URL does not use HTTPS", "warn");
  add(
    "proxy",
    f.trustProxy || !f.production,
    f.trustProxy ? "forwarded client addresses are trusted (reverse proxy)" : f.production ? "TRUST_PROXY is off: every request will appear to come from the proxy and rate limits will be shared" : "TRUST_PROXY is off (development)",
    "warn",
  );

  const smsReal = f.smsProvider === "http";
  if (f.customerAccountsEnabled) {
    add("sms_provider", smsReal, smsReal ? "an SMS gateway is configured" : `customer sign-in is enabled but SMS provider is "${f.smsProvider}": customers cannot receive codes`);
  } else {
    results.push({ name: "security.customer_accounts", status: "ok", message: "customer accounts are disabled" });
  }
  return results;
}

import { describe, expect, it } from "vitest";
import { assessBackups, DEFAULT_BACKUP_POLICY, type BackupFact } from "./backup";
import { clientErrorSchema, fingerprintInput, redactSensitive, redactUrlCredentials, sanitizeError, sanitizeUrl } from "./error-report";
import { publicHealth, summarizeHealth } from "./health";
import { canIncidentTransition, incidentCreateSchema, incidentUpdateSchema } from "./incident";
import { securityChecks, type SecurityFacts } from "./security-checks";

const NOW = new Date("2026-03-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const fact = (over: Partial<BackupFact> = {}): BackupFact => ({ takenAt: hoursAgo(2), restoreTestedAt: null, restoreTestOk: null, encrypted: true, ...over });

describe("backup assessment: never operational without a successful restore test", () => {
  it("none: no backups", () => {
    expect(assessBackups([], NOW)).toMatchObject({ state: "none", operational: false });
  });

  it("untested: fresh backups that were never restored are NOT operational", () => {
    const a = assessBackups([fact(), fact({ takenAt: hoursAgo(26) })], NOW);
    expect(a).toMatchObject({ state: "untested", operational: false, lastSuccessfulRestoreTestAt: null });
  });

  it("restore_failed: a failed test beats an older success", () => {
    const a = assessBackups([fact({ takenAt: hoursAgo(30), restoreTestedAt: hoursAgo(29), restoreTestOk: true }), fact({ takenAt: hoursAgo(5), restoreTestedAt: hoursAgo(4), restoreTestOk: false })], NOW);
    expect(a).toMatchObject({ state: "restore_failed", operational: false });
    expect(a.lastSuccessfulRestoreTestAt).toEqual(hoursAgo(29));
  });

  it("operational: recent backup and recent successful restore test", () => {
    const a = assessBackups([fact({ restoreTestedAt: hoursAgo(1), restoreTestOk: true })], NOW);
    expect(a).toMatchObject({ state: "operational", operational: true });
  });

  it("stale backup and stale restore test degrade the state", () => {
    expect(assessBackups([fact({ takenAt: hoursAgo(40), restoreTestedAt: hoursAgo(39), restoreTestOk: true })], NOW).state).toBe("stale_backup");
    const old = hoursAgo(24 * 40);
    expect(assessBackups([fact({ takenAt: old, restoreTestedAt: old, restoreTestOk: true }), fact()], NOW).state).toBe("stale_restore_test");
  });

  it("a successful restore test on an old backup still counts when a newer backup exists", () => {
    const a = assessBackups([fact({ takenAt: hoursAgo(24 * 10), restoreTestedAt: hoursAgo(24 * 9), restoreTestOk: true }), fact()], NOW, DEFAULT_BACKUP_POLICY);
    expect(a.state).toBe("operational");
  });
});

describe("health summary", () => {
  const ok = (name: string) => ({ name, status: "ok" as const, message: "" });
  it("is ok / degraded / down", () => {
    expect(summarizeHealth([ok("a")], NOW).status).toBe("ok");
    expect(summarizeHealth([ok("a"), { name: "storage", status: "fail", message: "" }], NOW).status).toBe("degraded");
    expect(summarizeHealth([ok("a"), { name: "backup", status: "warn", message: "" }], NOW).status).toBe("degraded");
    expect(summarizeHealth([{ name: "storage", status: "fail", message: "" }, { name: "database", status: "fail", message: "" }], NOW).status).toBe("down");
  });
  it("public view reveals only the status", () => {
    const report = summarizeHealth([{ name: "database", status: "fail", message: "connection refused to 10.0.0.5" }], NOW);
    expect(publicHealth(report)).toEqual({ status: "down", checkedAt: NOW.toISOString() });
  });
});

describe("incidents", () => {
  it("validates input", () => {
    expect(incidentCreateSchema.parse({ title: "قطعی درگاه پیامک", severity: "major" })).toMatchObject({ source: "manual", summary: "" });
    expect(incidentCreateSchema.safeParse({ title: "x", severity: "major" }).success).toBe(false);
    expect(incidentCreateSchema.safeParse({ title: "abc", severity: "huge" }).success).toBe(false);
    expect(incidentUpdateSchema.safeParse({ message: "" }).success).toBe(false);
  });
  it("limits transitions", () => {
    expect(canIncidentTransition("investigating", "resolved")).toBe(true);
    expect(canIncidentTransition("resolved", "monitoring")).toBe(false);
    expect(canIncidentTransition("resolved", "investigating")).toBe(true);
    expect(canIncidentTransition("monitoring", "monitoring")).toBe(false);
  });
});

describe("error report sanitising", () => {
  it("removes credentials, tokens, e-mails and phone numbers", () => {
    const dirty = [
      "connect postgresql://admin:hunter2@db.internal:5432/jaryan failed",
      "Authorization: Bearer abcdefghijklmnop12345",
      "cookie=jm_session=abcdef",
      "user ali@example.com phone 09121234567 and +989351234567",
      "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc",
      "hash " + "a".repeat(64),
    ].join(" | ");
    const clean = redactSensitive(dirty);
    for (const secret of ["hunter2", "abcdefghijklmnop12345", "jm_session=abcdef", "ali@example.com", "09121234567", "9351234567", "eyJhbGci", "a".repeat(32)]) expect(clean).not.toContain(secret);
  });

  it("strips query strings and credentials from URLs and rejects non-http schemes", () => {
    expect(sanitizeUrl("https://user:pw@shop.example/p/abc?token=SECRET&x=1#frag")).toBe("https://shop.example/p/abc");
    expect(sanitizeUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeUrl("not a url")).toBeNull();
    expect(sanitizeUrl(undefined)).toBeNull();
  });

  it("truncates and normalises", () => {
    const e = sanitizeError({ name: "Type<script>Error", message: "ab ".repeat(700), stack: "at x ".repeat(2000), url: "https://a.example/x?y=1" });
    expect(e.name).toBe("TypescriptError");
    expect(e.message).toHaveLength(500);
    expect(e.stack).toHaveLength(4000);
    expect(e.url).toBe("https://a.example/x");
  });

  it("groups repeats of the same error but separates different ones", () => {
    const a = sanitizeError({ name: "Error", message: "order 17 not found", stack: "Error: x\n    at find (/app/a.js:10:5)" });
    const b = sanitizeError({ name: "Error", message: "order 998 not found", stack: "Error: x\n    at find (/app/a.js:44:9)" });
    const c = sanitizeError({ name: "Error", message: "payment failed", stack: "Error: x\n    at pay (/app/b.js:1:1)" });
    expect(fingerprintInput("server", a)).toBe(fingerprintInput("server", b));
    expect(fingerprintInput("server", a)).not.toBe(fingerprintInput("server", c));
    expect(fingerprintInput("server", a)).not.toBe(fingerprintInput("storefront", a));
  });

  it("client error schema is strict and bounded", () => {
    expect(clientErrorSchema.safeParse({ message: "boom", extra: 1 }).success).toBe(false);
    expect(clientErrorSchema.safeParse({ message: "x".repeat(2001) }).success).toBe(false);
    expect(clientErrorSchema.parse({})).toMatchObject({ name: "Error", message: "" });
  });
});

describe("security checks", () => {
  const good: SecurityFacts = {
    production: true, encryptionKeyConfigured: true, cookieSecure: true, requireTotp: true, adminOrigins: ["https://admin.example.ir"], storageDriver: "s3",
    databaseIsEmbedded: false, trustProxy: true, customerAccountsEnabled: false, smsProvider: "disabled", publicMediaUrl: "https://media.example.ir", devAdminConfigured: false,
  };
  const failing = (f: SecurityFacts) => securityChecks(f).filter((c) => c.status === "fail").map((c) => c.name);

  it("passes a sound production configuration", () => {
    expect(securityChecks(good).every((c) => c.status === "ok")).toBe(true);
  });

  it("fails unsafe production settings", () => {
    const bad = failing({ ...good, encryptionKeyConfigured: false, cookieSecure: false, requireTotp: false, adminOrigins: ["http://admin.example.ir", "https://*.example.ir"], storageDriver: "local", databaseIsEmbedded: true, devAdminConfigured: true });
    expect(bad).toEqual(expect.arrayContaining(["security.encryption_key", "security.cookies", "security.totp", "security.admin_origins", "security.storage", "security.database", "security.dev_admin"]));
  });

  it("requires a real SMS gateway when customer accounts are enabled", () => {
    expect(failing({ ...good, customerAccountsEnabled: true, smsProvider: "console" })).toEqual(["security.sms_provider"]);
    expect(failing({ ...good, customerAccountsEnabled: true, smsProvider: "http" })).toEqual([]);
  });

  it("only warns outside production", () => {
    const dev = securityChecks({ ...good, production: false, cookieSecure: false, encryptionKeyConfigured: false });
    expect(dev.some((c) => c.status === "fail")).toBe(false);
    expect(dev.some((c) => c.status === "warn")).toBe(true);
  });
});

describe("redaction keeps the key name", () => {
  it("replaces only the value", () => {
    expect(redactSensitive("password=hunter2 ok")).toBe("password=[redacted] ok");
  });
});

describe("URL credential redaction keeps paths intact", () => {
  it("masks only user:password@", () => {
    expect(redactUrlCredentials("s3://key:pw@host/bucket/db.dump")).toBe("s3://[credentials]@host/bucket/db.dump");
    const path = "/srv/backups/jaryan-db-2026-10-26T20-44-17-704Z.dump.enc";
    expect(redactUrlCredentials(path)).toBe(path);
  });
});

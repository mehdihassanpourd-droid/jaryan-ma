import { createHash } from "node:crypto";
import { assessBackups, DEFAULT_BACKUP_POLICY, type BackupAssessment, type BackupPolicy } from "../../src/domain/maintenance/backup";
import { fingerprintInput, redactSensitive, redactUrlCredentials, sanitizeError } from "../../src/domain/maintenance/error-report";
import { summarizeHealth, type CheckResult, type HealthReport } from "../../src/domain/maintenance/health";
import { canIncidentTransition, type IncidentCreate, type IncidentUpdate } from "../../src/domain/maintenance/incident";
import { securityChecks, type SecurityFacts } from "../../src/domain/maintenance/security-checks";
import { can, type Action, type Role } from "../auth/rbac";
import type { BackupKind, MaintenanceStore } from "./ports";

export type MaintenanceErrorCode = "forbidden" | "not_found" | "invalid_transition" | "validation";

export class MaintenanceError extends Error {
  constructor(public code: MaintenanceErrorCode) {
    super(code);
    this.name = "MaintenanceError";
  }
}

export interface Operator {
  email: string;
  role: Role;
}

/** The running system's probes; each throws (or returns a failing result) when the part is unhealthy. */
export interface HealthProbes {
  database(): Promise<void>;
  migrations(): Promise<CheckResult>;
  storage(): Promise<void>;
  security(): SecurityFacts;
  /** Customer accounts waiting for erasure past their deadline (a stuck job). */
  overdueDeletions?(): Promise<number>;
}

export interface MaintenanceSettings {
  backupPolicy: BackupPolicy;
  /** Unresolved error reports seen within the last hour that turn the "errors" check to a warning / failure. */
  errorWarnPerHour: number;
  errorFailPerHour: number;
  keepResolvedErrorsDays: number;
  keepLogDays: number;
}

export const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  backupPolicy: DEFAULT_BACKUP_POLICY,
  errorWarnPerHour: 5,
  errorFailPerHour: 50,
  keepResolvedErrorsDays: 90,
  keepLogDays: 400,
};

/** Removes anything secret-looking from log detail before it is stored. */
export function scrubDetail(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSensitive(value).slice(0, 1000);
  if (depth > 4 || value === null || typeof value !== "object") return typeof value === "number" || typeof value === "boolean" || value === null ? value : undefined;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubDetail(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 50)
      .map(([k, v]) => [k, /pass|secret|token|key|cookie|authorization/i.test(k) ? "[redacted]" : scrubDetail(v, depth + 1)]),
  );
}

const timed = async (name: string, run: () => Promise<CheckResult | void>, okMessage: string): Promise<CheckResult> => {
  const started = Date.now();
  try {
    const result = await run();
    return { ...(result ?? { name, status: "ok" as const, message: okMessage }), name, durationMs: Date.now() - started };
  } catch {
    // The error text is deliberately not copied: it may contain connection strings or hostnames.
    return { name, status: "fail", message: "check failed", durationMs: Date.now() - started };
  }
};

export class MaintenanceService {
  constructor(
    private readonly store: MaintenanceStore,
    private readonly probes: HealthProbes,
    private readonly settings: MaintenanceSettings = DEFAULT_MAINTENANCE_SETTINGS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private require(op: Operator, action: Action) {
    if (!can(op.role, action)) throw new MaintenanceError("forbidden");
  }

  // ---- health ----------------------------------------------------------------------------------

  /** Detailed health for an authenticated operator. */
  async healthFor(op: Operator): Promise<HealthReport> {
    this.require(op, "maintenance:read");
    return this.runHealth();
  }

  async backupStatusFor(op: Operator) {
    this.require(op, "maintenance:read");
    return this.backupStatus();
  }

  /** Runs every check. Safe to call often; the storage probe writes and deletes one tiny object. */
  async runHealth(): Promise<HealthReport> {
    const now = this.clock();
    const checks: CheckResult[] = [];
    checks.push(await timed("database", () => this.probes.database(), "database reachable"));
    if (checks[0]?.status === "ok") checks.push(await timed("migrations", () => this.probes.migrations(), "all migrations applied"));
    else checks.push({ name: "migrations", status: "fail", message: "not checked: database unreachable" });
    checks.push(await timed("storage", () => this.probes.storage(), "object storage writable"));

    const db = await this.safe(() => this.backupStatus());
    if (db) {
      const a = db.database;
      checks.push({ name: "backup", status: a.operational ? "ok" : a.state === "none" || a.state === "untested" ? "warn" : "fail", message: `database backup: ${a.state}` });
    }
    const recent = await this.safe(() => this.store.countErrorsSince(new Date(now.getTime() - 3600_000)));
    if (recent !== null) {
      checks.push({
        name: "errors",
        status: recent >= this.settings.errorFailPerHour ? "fail" : recent >= this.settings.errorWarnPerHour ? "warn" : "ok",
        message: `${recent} unresolved error group(s) seen in the last hour`,
      });
    }
    if (this.probes.overdueDeletions) {
      const overdue = await this.safe(() => this.probes.overdueDeletions!());
      if (overdue !== null) checks.push({ name: "deletions", status: overdue > 0 ? "warn" : "ok", message: overdue > 0 ? `${overdue} account deletion(s) overdue` : "no overdue deletions" });
    }
    checks.push(...securityChecks(this.probes.security()));
    return summarizeHealth(checks, now);
  }

  private async safe<T>(run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch {
      return null;
    }
  }

  /**
   * Scheduled job: runs the checks and keeps exactly one incident open while the service is unhealthy
   * (down or a failing check), resolving it when everything passes again.
   */
  async healthCycle(): Promise<HealthReport> {
    const report = await this.runHealth();
    const now = this.clock();
    const failing = report.checks.filter((c) => c.status === "fail");
    const open = await this.store.findOpenIncident("health_check");
    if (failing.length > 0 && !open) {
      const incident = await this.store.createIncident(
        { title: report.status === "down" ? "سرویس در دسترس نیست" : "اختلال در بخشی از سرویس", severity: report.status === "down" ? "critical" : "major", source: "health_check", summary: `Failing checks: ${failing.map((c) => c.name).join(", ")}`, startedAt: now, createdBy: "system" },
        now,
      );
      await this.store.log({ actor: "system", action: "incident.auto_opened", target: `incident:${incident.number}`, outcome: "failure", detail: { checks: failing.map((c) => c.name) } }, now);
    } else if (failing.length === 0 && open) {
      await this.store.updateIncident(open.number, { status: "resolved", message: "All health checks pass again.", author: "system" }, now);
      await this.store.log({ actor: "system", action: "incident.auto_resolved", target: `incident:${open.number}`, outcome: "success", detail: {} }, now);
    }
    return report;
  }

  // ---- incidents ---------------------------------------------------------------------------------

  async createIncident(op: Operator, input: IncidentCreate) {
    this.require(op, "maintenance:write");
    const now = this.clock();
    const startedAt = input.startedAt && input.startedAt <= now ? input.startedAt : now;
    const row = await this.store.createIncident({ title: input.title, severity: input.severity, source: input.source, summary: input.summary, startedAt, createdBy: op.email }, now);
    await this.store.log({ actor: op.email, action: "incident.create", target: `incident:${row.number}`, outcome: "success", detail: { severity: row.severity, source: row.source } }, now);
    return row;
  }

  async listIncidents(op: Operator, filter: { open?: boolean } = {}, limit = 50) {
    this.require(op, "maintenance:read");
    return this.store.listIncidents(filter, Math.min(limit, 200));
  }

  async getIncident(op: Operator, number: number) {
    this.require(op, "maintenance:read");
    const row = await this.store.getIncident(number);
    if (!row) throw new MaintenanceError("not_found");
    return row;
  }

  async updateIncident(op: Operator, number: number, input: IncidentUpdate) {
    this.require(op, "maintenance:write");
    const current = await this.store.getIncident(number);
    if (!current) throw new MaintenanceError("not_found");
    if (input.status && !canIncidentTransition(current.status, input.status)) throw new MaintenanceError("invalid_transition");
    const now = this.clock();
    await this.store.updateIncident(number, { status: input.status, severity: input.severity, message: input.message, author: op.email }, now);
    await this.store.log({ actor: op.email, action: "incident.update", target: `incident:${number}`, outcome: "success", detail: { status: input.status, severity: input.severity } }, now);
  }

  // ---- backups ------------------------------------------------------------------------------------

  async recordBackup(op: Operator, input: { kind: BackupKind; takenAt: Date; sizeBytes: number; location: string; sha256?: string | null; encrypted: boolean }) {
    this.require(op, "maintenance:write");
    const now = this.clock();
    if (input.takenAt > now || !Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0) throw new MaintenanceError("validation");
    const row = await this.store.recordBackup({ ...input, sha256: input.sha256 ?? null, location: redactUrlCredentials(input.location).slice(0, 300), recordedBy: op.email }, now);
    await this.store.log({ actor: op.email, action: "backup.record", target: `backup:${row.id}`, outcome: "success", detail: { kind: input.kind, sizeBytes: input.sizeBytes, encrypted: input.encrypted } }, now);
    return row;
  }

  /** Records the result of actually restoring a backup into a scratch database and checking it. */
  async recordRestoreTest(op: Operator, backupId: string, ok: boolean, notes: string | null = null) {
    this.require(op, "maintenance:write");
    const now = this.clock();
    if (!(await this.store.recordRestoreTest(backupId, ok, notes ? redactSensitive(notes).slice(0, 1000) : null, now))) throw new MaintenanceError("not_found");
    await this.store.log({ actor: op.email, action: "backup.restore_test", target: `backup:${backupId}`, outcome: ok ? "success" : "failure", detail: {} }, now);
    if (!ok && !(await this.store.findOpenIncident("backup"))) {
      await this.store.createIncident({ title: "آزمون بازیابی پشتیبان ناموفق بود", severity: "major", source: "backup", summary: "A restore test failed; backups must not be trusted until one succeeds.", startedAt: now, createdBy: "system" }, now);
    }
  }

  async backupStatus(): Promise<Record<BackupKind, BackupAssessment>> {
    const now = this.clock();
    const [database, media] = await Promise.all([this.store.backupFacts("database"), this.store.backupFacts("media")]);
    return { database: assessBackups(database, now, this.settings.backupPolicy), media: assessBackups(media, now, this.settings.backupPolicy) };
  }

  async listBackups(op: Operator, kind: BackupKind) {
    this.require(op, "maintenance:read");
    return this.store.listBackups(kind, 50);
  }

  // ---- error reports -------------------------------------------------------------------------------

  /** Stores one error occurrence (sanitised, de-duplicated by fingerprint). Never throws to the caller's hot path. */
  async reportError(input: { source: "server" | "storefront" | "admin"; environment: string; release?: string | null; name?: string; message?: string; stack?: string; url?: string }) {
    const clean = sanitizeError(input);
    const fingerprint = createHash("sha256").update(fingerprintInput(input.source, clean)).digest("hex").slice(0, 32);
    return this.store.upsertError({ fingerprint, source: input.source, environment: input.environment.slice(0, 20), release: input.release?.slice(0, 64) ?? null, ...clean }, this.clock());
  }

  async listErrors(op: Operator, filter: { resolved?: boolean } = {}, limit = 50) {
    this.require(op, "maintenance:read");
    return this.store.listErrors(filter, Math.min(limit, 200));
  }

  async resolveError(op: Operator, id: string) {
    this.require(op, "maintenance:write");
    if (!(await this.store.resolveError(id))) throw new MaintenanceError("not_found");
    await this.store.log({ actor: op.email, action: "error.resolve", target: `error:${id}`, outcome: "success", detail: {} }, this.clock());
  }

  // ---- maintenance audit log -----------------------------------------------------------------------

  /** Records an operational action performed outside the API (deploy, migration, restore, key rotation). */
  async logAction(actor: string, action: string, target: string | null, outcome: "success" | "failure", detail: Record<string, unknown> = {}) {
    await this.store.log({ actor: redactSensitive(actor).slice(0, 100), action: action.slice(0, 80), target: target?.slice(0, 120) ?? null, outcome, detail: scrubDetail(detail) as Record<string, unknown> }, this.clock());
  }

  async listLog(op: Operator, filter: { action?: string } = {}, limit = 100) {
    this.require(op, "maintenance:read");
    return this.store.listLog(filter, Math.min(limit, 500));
  }

  /** Scheduled job: removes old resolved error reports and very old audit entries. */
  async prune() {
    const now = this.clock();
    return this.store.prune({
      resolvedErrorsBefore: new Date(now.getTime() - this.settings.keepResolvedErrorsDays * 86_400_000),
      logBefore: new Date(now.getTime() - this.settings.keepLogDays * 86_400_000),
    });
  }
}

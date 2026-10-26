import type { BackupFact } from "../../src/domain/maintenance/backup";
import type { IncidentStatus } from "../../src/domain/maintenance/incident";

export type Severity = "minor" | "major" | "critical";
export type IncidentSource = "manual" | "health_check" | "deployment" | "security" | "backup";

export interface IncidentRow {
  number: number;
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  source: IncidentSource;
  summary: string;
  startedAt: Date;
  resolvedAt: Date | null;
  createdBy: string;
}

export interface IncidentDetail extends IncidentRow {
  updates: Array<{ at: Date; author: string; status: IncidentStatus | null; message: string }>;
}

export type BackupKind = "database" | "media";

export interface BackupRow extends BackupFact {
  id: string;
  kind: BackupKind;
  sizeBytes: number;
  location: string;
  sha256: string | null;
  recordedBy: string;
  restoreTestNotes: string | null;
}

export interface ErrorReportRow {
  id: string;
  fingerprint: string;
  source: string;
  environment: string;
  release: string | null;
  name: string;
  message: string;
  stack: string | null;
  url: string | null;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolved: boolean;
}

export interface MaintenanceLogRow {
  id: string;
  at: Date;
  actor: string;
  action: string;
  target: string | null;
  outcome: "success" | "failure";
  detail: unknown;
}

export interface MaintenanceStore {
  // incidents
  createIncident(data: { title: string; severity: Severity; source: IncidentSource; summary: string; startedAt: Date; createdBy: string }, now: Date): Promise<IncidentRow>;
  listIncidents(filter: { open?: boolean }, limit: number): Promise<IncidentRow[]>;
  getIncident(number: number): Promise<IncidentDetail | null>;
  /** Applies a status/severity change and appends the update, in one transaction. */
  updateIncident(number: number, patch: { status?: IncidentStatus; severity?: Severity; message: string; author: string }, now: Date): Promise<boolean>;
  findOpenIncident(source: IncidentSource): Promise<IncidentRow | null>;

  // backups
  recordBackup(data: { kind: BackupKind; takenAt: Date; sizeBytes: number; location: string; sha256: string | null; encrypted: boolean; recordedBy: string }, now: Date): Promise<BackupRow>;
  /** False when the backup does not exist. */
  recordRestoreTest(id: string, ok: boolean, notes: string | null, testedAt: Date): Promise<boolean>;
  listBackups(kind: BackupKind, limit: number): Promise<BackupRow[]>;
  backupFacts(kind: BackupKind): Promise<BackupFact[]>;

  // error reports
  upsertError(data: { fingerprint: string; source: string; environment: string; release: string | null; name: string; message: string; stack: string | null; url: string | null }, now: Date): Promise<ErrorReportRow>;
  listErrors(filter: { resolved?: boolean }, limit: number): Promise<ErrorReportRow[]>;
  resolveError(id: string): Promise<boolean>;
  countErrorsSince(since: Date): Promise<number>;

  // maintenance audit log
  log(entry: { actor: string; action: string; target: string | null; outcome: "success" | "failure"; detail: Record<string, unknown> }, at: Date): Promise<void>;
  listLog(filter: { action?: string }, limit: number): Promise<MaintenanceLogRow[]>;

  // housekeeping
  prune(opts: { resolvedErrorsBefore: Date; logBefore: Date }): Promise<{ errors: number; log: number }>;
}

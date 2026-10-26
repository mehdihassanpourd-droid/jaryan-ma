/**
 * Backup status is derived from facts, never declared. A backup stream is only "operational" when
 * (1) a recent backup exists AND (2) a restore from a recent backup was actually tested successfully.
 * A backup that was never restored is just a file we hope is good.
 */
export interface BackupFact {
  takenAt: Date;
  restoreTestedAt: Date | null;
  restoreTestOk: boolean | null;
  encrypted: boolean;
}

export interface BackupPolicy {
  /** Newest backup must be younger than this. */
  maxBackupAgeHours: number;
  /** Newest successful restore test must be younger than this. */
  maxRestoreTestAgeDays: number;
}

export const DEFAULT_BACKUP_POLICY: BackupPolicy = { maxBackupAgeHours: 36, maxRestoreTestAgeDays: 35 };

export type BackupState =
  /** No backup has ever been recorded. */
  | "none"
  /** Backups exist but no restore from any of them has ever succeeded. NOT operational. */
  | "untested"
  /** The newest restore test failed. NOT operational. */
  | "restore_failed"
  /** The newest backup is too old. */
  | "stale_backup"
  /** The last successful restore test is too old to be trusted. */
  | "stale_restore_test"
  /** Recent backup and a recent successful restore test. */
  | "operational";

export interface BackupAssessment {
  state: BackupState;
  operational: boolean;
  lastBackupAt: Date | null;
  lastSuccessfulRestoreTestAt: Date | null;
  /** Human-readable reason (English, for logs and the admin API; the UI translates by `state`). */
  reason: string;
}

export function assessBackups(facts: BackupFact[], now: Date, policy: BackupPolicy = DEFAULT_BACKUP_POLICY): BackupAssessment {
  const newest = facts.reduce<BackupFact | null>((a, b) => (a === null || b.takenAt > a.takenAt ? b : a), null);
  const tested = facts.filter((f) => f.restoreTestedAt !== null && f.restoreTestOk !== null);
  const lastTest = tested.reduce<BackupFact | null>((a, b) => (a === null || (b.restoreTestedAt as Date) > (a.restoreTestedAt as Date) ? b : a), null);
  const lastOk = tested.filter((f) => f.restoreTestOk === true).reduce<Date | null>((a, b) => (a === null || (b.restoreTestedAt as Date) > a ? (b.restoreTestedAt as Date) : a), null);

  const base = { lastBackupAt: newest?.takenAt ?? null, lastSuccessfulRestoreTestAt: lastOk };
  const result = (state: BackupState, reason: string): BackupAssessment => ({ ...base, state, operational: state === "operational", reason });

  if (!newest) return result("none", "no backup has been recorded");
  if (lastTest && lastTest.restoreTestOk === false) return result("restore_failed", "the most recent restore test failed");
  if (!lastOk) return result("untested", "backups exist but none has ever been restored successfully");
  if (now.getTime() - newest.takenAt.getTime() > policy.maxBackupAgeHours * 3600_000) return result("stale_backup", `newest backup is older than ${policy.maxBackupAgeHours} hours`);
  if (now.getTime() - lastOk.getTime() > policy.maxRestoreTestAgeDays * 24 * 3600_000) return result("stale_restore_test", `last successful restore test is older than ${policy.maxRestoreTestAgeDays} days`);
  return result("operational", "recent backup and a recent successful restore test");
}

export type CheckStatus = "ok" | "warn" | "fail";

export interface CheckResult {
  /** Stable identifier, e.g. "database". */
  name: string;
  status: CheckStatus;
  /** Short, non-sensitive description. Never contains secrets, connection strings or personal data. */
  message: string;
  /** Milliseconds the check took, when measured. */
  durationMs?: number;
}

export type OverallStatus = "ok" | "degraded" | "down";

export interface HealthReport {
  status: OverallStatus;
  checkedAt: Date;
  checks: CheckResult[];
}

/** Checks that make the whole service unusable when they fail (everything else only degrades it). */
export const CRITICAL_CHECKS = ["database", "migrations"] as const;

export function summarizeHealth(checks: CheckResult[], checkedAt: Date): HealthReport {
  let status: OverallStatus = "ok";
  for (const c of checks) {
    if (c.status === "fail") {
      if ((CRITICAL_CHECKS as readonly string[]).includes(c.name)) {
        status = "down";
        break;
      }
      status = "degraded";
    } else if (c.status === "warn" && status === "ok") status = "degraded";
  }
  return { status, checkedAt, checks };
}

/** What the unauthenticated /health endpoint may reveal: nothing but the overall state. */
export function publicHealth(report: HealthReport): { status: OverallStatus; checkedAt: string } {
  return { status: report.status, checkedAt: report.checkedAt.toISOString() };
}

import type { Role } from "./rbac";

/**
 * Ports for administrator authentication. The server depends on these interfaces only:
 * the default implementations are PostgreSQL (Prisma) and in-memory stores, and the identity
 * mechanism (`Authenticator`) can be replaced, e.g. by an OIDC provider, without touching the API.
 */
export interface AdminAccount {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  totpSecretEnc: string | null;
  totpLastStep: number | null;
  disabled: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
}

export interface SessionRecord {
  id: string;
  userId: string;
  /** SHA-256 (hex) of the session token. The token itself is never stored. */
  tokenHash: string;
  csrfToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

export interface AuditEntry {
  actorEmail: string;
  action: string;
  entity: string;
  entityId: string;
  detail?: Record<string, unknown>;
  at: Date;
}

export class AccountExistsError extends Error {
  constructor() {
    super("account_exists");
    this.name = "AccountExistsError";
  }
}

export interface AdminStore {
  findByEmail(email: string): Promise<AdminAccount | null>;
  findById(id: string): Promise<AdminAccount | null>;
  listAccounts(): Promise<AdminAccount[]>;
  /** Throws AccountExistsError when the email is taken. */
  createAccount(data: { email: string; passwordHash: string; role: Role; totpSecretEnc: string | null }): Promise<AdminAccount>;
  setPassword(id: string, passwordHash: string, at: Date): Promise<void>;
  /** Sets or clears the TOTP secret and resets replay protection. */
  setTotp(id: string, secretEnc: string | null): Promise<void>;
  setDisabled(id: string, disabled: boolean): Promise<void>;
  /** Atomic compare-and-set: true only if `step` is newer than any accepted step (blocks replay). */
  acceptTotpStep(id: string, step: number): Promise<boolean>;
  /** Increments and returns the failed-login counter. */
  recordFailure(id: string): Promise<number>;
  clearFailures(id: string): Promise<void>;
  /** Locks the account and resets the failure counter. */
  lock(id: string, until: Date): Promise<void>;

  createSession(data: Omit<SessionRecord, "id">): Promise<SessionRecord>;
  findSession(tokenHash: string): Promise<(SessionRecord & { account: AdminAccount }) | null>;
  touchSession(id: string, at: Date): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteSessionsForUser(userId: string, exceptSessionId?: string): Promise<void>;
  purgeExpired(now: Date): Promise<number>;

  audit(entry: AuditEntry): Promise<void>;
}

export interface Principal {
  userId: string;
  email: string;
  role: Role;
  sessionId: string;
  csrfToken: string;
}

/** Identifies the caller of an API request, or returns null. Swappable (session cookie today). */
export interface Authenticator {
  authenticate(request: Request): Promise<Principal | null>;
}

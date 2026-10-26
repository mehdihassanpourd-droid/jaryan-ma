import { checkPasswordPolicy, type PasswordHasher, type PasswordIssue } from "./password";
import type { AdminAccount, AdminStore, Principal } from "./ports";
import type { RateLimiter } from "./rate-limit";
import type { Role } from "./rbac";
import type { SecretBox } from "./secret-box";
import { newToken, sha256Hex } from "./session";
import { otpauthUri, verifyTotp } from "./totp";

export type AuthFailureCode =
  | "invalid_credentials"
  | "totp_required"
  | "invalid_totp"
  | "totp_not_enrolled"
  | "too_many_attempts"
  | "weak_password";

export class AuthFailure extends Error {
  constructor(
    public code: AuthFailureCode,
    public retryAfterSeconds?: number,
    public issues?: PasswordIssue[],
  ) {
    super(code);
    this.name = "AuthFailure";
  }
}

export interface AuthSettings {
  sessionAbsoluteMs: number;
  /** TOTP is mandatory: accounts without it cannot sign in. Only disable for local development. */
  requireTotp: boolean;
  /** Consecutive failures that lock an account. */
  lockThreshold: number;
  lockMs: number;
  /** Attempts per IP / per email within `attemptWindowMs`. */
  ipLimit: number;
  emailLimit: number;
  attemptWindowMs: number;
  issuer: string;
}

export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  sessionAbsoluteMs: 12 * 3600_000,
  requireTotp: true,
  lockThreshold: 5,
  lockMs: 15 * 60_000,
  ipLimit: 30,
  emailLimit: 10,
  attemptWindowMs: 15 * 60_000,
  issuer: "Jaryan Ma",
};

export interface LoginInput {
  email: string;
  password: string;
  totp?: string;
  ip: string;
  userAgent: string | null;
}

export interface LoginResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  account: { email: string; role: Role };
}

export const normalizeEmail = (email: string) => email.normalize("NFKC").trim().toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly store: AdminStore,
    private readonly hasher: PasswordHasher,
    private readonly box: SecretBox,
    private readonly limiter: RateLimiter,
    private readonly settings: AuthSettings = DEFAULT_AUTH_SETTINGS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Hash used to burn the same time for unknown emails, so response time does not reveal which exist. */
  private dummy(): Promise<string> {
    this.dummyHash ??= this.hasher.hash(newToken());
    return this.dummyHash;
  }

  private async fail(account: AdminAccount, now: Date): Promise<void> {
    const failures = await this.store.recordFailure(account.id);
    if (failures >= this.settings.lockThreshold) {
      await this.store.lock(account.id, new Date(now.getTime() + this.settings.lockMs));
      await this.store.audit({ actorEmail: account.email, action: "admin.locked", entity: "admin", entityId: account.id, at: now });
    }
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const now = this.clock();
    const { attemptWindowMs: window } = this.settings;

    const byIp = this.limiter.hit(`ip:${input.ip}`, this.settings.ipLimit, window);
    const byEmail = this.limiter.hit(`email:${email}`, this.settings.emailLimit, window);
    if (!byIp.allowed || !byEmail.allowed) throw new AuthFailure("too_many_attempts", Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds));

    const account = EMAIL_PATTERN.test(email) ? await this.store.findByEmail(email) : null;
    if (!account || account.disabled) {
      await this.hasher.verify(input.password, await this.dummy());
      throw new AuthFailure("invalid_credentials");
    }
    if (account.lockedUntil && account.lockedUntil > now) {
      throw new AuthFailure("too_many_attempts", Math.ceil((account.lockedUntil.getTime() - now.getTime()) / 1000));
    }

    if (!(await this.hasher.verify(input.password, account.passwordHash))) {
      await this.fail(account, now);
      await this.store.audit({ actorEmail: account.email, action: "login.failed", entity: "admin", entityId: account.id, detail: { ip: input.ip }, at: now });
      throw new AuthFailure("invalid_credentials");
    }

    if (account.totpSecretEnc) {
      if (!input.totp) throw new AuthFailure("totp_required");
      const step = verifyTotp(this.box.open(account.totpSecretEnc), input.totp.trim(), now.getTime(), account.totpLastStep);
      if (step === null || !(await this.store.acceptTotpStep(account.id, step))) {
        await this.fail(account, now);
        await this.store.audit({ actorEmail: account.email, action: "login.failed", entity: "admin", entityId: account.id, detail: { ip: input.ip, reason: "totp" }, at: now });
        throw new AuthFailure("invalid_totp");
      }
    } else if (this.settings.requireTotp) {
      throw new AuthFailure("totp_not_enrolled");
    }

    await this.store.clearFailures(account.id);
    if (this.hasher.needsRehash(account.passwordHash)) await this.store.setPassword(account.id, await this.hasher.hash(input.password), now);

    const token = newToken();
    const csrfToken = newToken(24);
    const expiresAt = new Date(now.getTime() + this.settings.sessionAbsoluteMs);
    await this.store.createSession({ userId: account.id, tokenHash: sha256Hex(token), csrfToken, createdAt: now, lastSeenAt: now, expiresAt, ip: input.ip, userAgent: input.userAgent?.slice(0, 300) ?? null });
    await this.store.audit({ actorEmail: account.email, action: "login.success", entity: "admin", entityId: account.id, detail: { ip: input.ip }, at: now });
    return { token, csrfToken, expiresAt, account: { email: account.email, role: account.role } };
  }

  async logout(principal: Principal): Promise<void> {
    await this.store.deleteSession(principal.sessionId);
    await this.store.audit({ actorEmail: principal.email, action: "logout", entity: "admin", entityId: principal.userId, at: this.clock() });
  }

  /** Verifies the current password, applies the policy and signs out every other session. */
  async changePassword(principal: Principal, current: string, next: string): Promise<void> {
    const account = await this.store.findById(principal.userId);
    if (!account || !(await this.hasher.verify(current, account.passwordHash))) throw new AuthFailure("invalid_credentials");
    const issues = checkPasswordPolicy(next, account.email);
    if (issues.length > 0) throw new AuthFailure("weak_password", undefined, issues);
    const now = this.clock();
    await this.store.setPassword(account.id, await this.hasher.hash(next), now);
    await this.store.deleteSessionsForUser(account.id, principal.sessionId);
    await this.store.audit({ actorEmail: account.email, action: "password.changed", entity: "admin", entityId: account.id, at: now });
  }

  /**
   * Creates an administrator (used by the command-line tool; there is no public sign-up and no default
   * account). `totpSecret` is the base32 seed the person has already confirmed with a code.
   */
  async createAccount(input: { email: string; password: string; role: Role; totpSecret: string | null }): Promise<AdminAccount> {
    const email = normalizeEmail(input.email);
    if (!EMAIL_PATTERN.test(email)) throw new Error("invalid_email");
    const issues = checkPasswordPolicy(input.password, email);
    if (issues.length > 0) throw new AuthFailure("weak_password", undefined, issues);
    if (this.settings.requireTotp && !input.totpSecret) throw new AuthFailure("totp_not_enrolled");
    const account = await this.store.createAccount({
      email,
      role: input.role,
      passwordHash: await this.hasher.hash(input.password),
      totpSecretEnc: input.totpSecret ? this.box.seal(input.totpSecret) : null,
    });
    await this.store.audit({ actorEmail: "cli", action: "admin.created", entity: "admin", entityId: account.id, detail: { email, role: input.role }, at: this.clock() });
    return account;
  }

  private async accountByEmail(email: string): Promise<AdminAccount> {
    const account = await this.store.findByEmail(normalizeEmail(email));
    if (!account) throw new Error("account_not_found");
    return account;
  }

  /** Sets a new password and signs the person out everywhere (command-line recovery). */
  async resetPassword(email: string, password: string): Promise<void> {
    const account = await this.accountByEmail(email);
    const issues = checkPasswordPolicy(password, account.email);
    if (issues.length > 0) throw new AuthFailure("weak_password", undefined, issues);
    const now = this.clock();
    await this.store.setPassword(account.id, await this.hasher.hash(password), now);
    await this.store.clearFailures(account.id);
    await this.store.deleteSessionsForUser(account.id);
    await this.store.audit({ actorEmail: "cli", action: "password.reset", entity: "admin", entityId: account.id, at: now });
  }

  /** Replaces the TOTP seed (lost phone) and signs the person out everywhere. */
  async resetTotp(email: string, totpSecret: string): Promise<void> {
    const account = await this.accountByEmail(email);
    await this.store.setTotp(account.id, this.box.seal(totpSecret));
    await this.store.deleteSessionsForUser(account.id);
    await this.store.audit({ actorEmail: "cli", action: "totp.reset", entity: "admin", entityId: account.id, at: this.clock() });
  }

  async setDisabled(email: string, disabled: boolean): Promise<void> {
    const account = await this.accountByEmail(email);
    await this.store.setDisabled(account.id, disabled);
    if (disabled) await this.store.deleteSessionsForUser(account.id);
    await this.store.audit({ actorEmail: "cli", action: disabled ? "admin.disabled" : "admin.enabled", entity: "admin", entityId: account.id, at: this.clock() });
  }

  async listAccounts() {
    return (await this.store.listAccounts()).map((a) => ({ email: a.email, role: a.role, disabled: a.disabled, totpEnrolled: a.totpSecretEnc !== null, locked: a.lockedUntil !== null && a.lockedUntil > this.clock() }));
  }

  provisioningUri(email: string, secret: string): string {
    return otpauthUri({ secret, account: email, issuer: this.settings.issuer });
  }
}

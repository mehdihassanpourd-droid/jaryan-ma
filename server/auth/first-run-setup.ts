import { AuthFailure, EMAIL_PATTERN, normalizeEmail, type AuthService } from "./auth-service";
import { checkPasswordPolicy, type PasswordIssue } from "./password";
import type { AdminStore } from "./ports";
import type { RateLimiter } from "./rate-limit";
import { newToken } from "./session";
import { generateTotpSecret, verifyTotp } from "./totp";

export type SetupFailureCode = "setup_closed" | "too_many_attempts" | "invalid_email" | "weak_password" | "setup_expired" | "invalid_totp";

export class SetupFailure extends Error {
  constructor(
    public code: SetupFailureCode,
    public retryAfterSeconds?: number,
    public issues?: PasswordIssue[],
  ) {
    super(code);
    this.name = "SetupFailure";
  }
}

const MAX_CODE_ATTEMPTS = 5;

/**
 * Creating the FIRST administrator from the browser, for throw-away development environments (a phone has no
 * comfortable terminal). It is the same account the command-line tool creates, with the same rules, and nothing weaker:
 * a strong password, and a mandatory TOTP seed that the person must prove they hold by entering a current code, before
 * anything is stored.
 *
 * Safety properties:
 *  - Off unless `FIRST_RUN_SETUP=true`; the configuration REFUSES that flag in production.
 *  - Open only while there are zero administrators; the first account closes it for good (checked again at the moment of
 *    creation). It can never add a second account, reset a password or reset TOTP.
 *  - Everything pending lives in memory for 10 minutes; nothing is written until the TOTP code is confirmed.
 *  - Rate limited per client address; a pending setup is discarded after 5 wrong codes.
 *  - Only reachable by people who can reach the server at all (in a Codespace: the owner, behind GitHub's private port).
 */
export class FirstRunSetup {
  private pending = new Map<string, { email: string; password: string; secret: string; expiresAt: number; attempts: number }>();

  constructor(
    private readonly enabled: boolean,
    private readonly auth: AuthService,
    private readonly store: AdminStore,
    private readonly limiter: RateLimiter,
    private readonly clock: () => Date = () => new Date(),
    private readonly ttlMs = 10 * 60_000,
  ) {}

  async isOpen(): Promise<boolean> {
    return this.enabled && (await this.store.listAccounts()).length === 0;
  }

  private throttle(ip: string): void {
    const hit = this.limiter.hit(`setup:${ip}`, 15, 15 * 60_000);
    if (!hit.allowed) throw new SetupFailure("too_many_attempts", hit.retryAfterSeconds);
  }

  /** Validates the choices and hands out a TOTP seed to add to an authenticator app. Stores nothing durable. */
  async begin(input: { email: string; password: string; ip: string }): Promise<{ token: string; secret: string; otpauthUri: string; expiresInSeconds: number }> {
    this.throttle(input.ip);
    if (!(await this.isOpen())) throw new SetupFailure("setup_closed");
    const email = normalizeEmail(input.email);
    if (!EMAIL_PATTERN.test(email)) throw new SetupFailure("invalid_email");
    const issues = checkPasswordPolicy(input.password, email);
    if (issues.length > 0) throw new SetupFailure("weak_password", undefined, issues);

    const secret = generateTotpSecret();
    const token = newToken();
    this.pending.clear(); // one setup at a time: a new attempt replaces the old one
    this.pending.set(token, { email, password: input.password, secret, expiresAt: this.clock().getTime() + this.ttlMs, attempts: 0 });
    return { token, secret, otpauthUri: this.auth.provisioningUri(email, secret), expiresInSeconds: Math.floor(this.ttlMs / 1000) };
  }

  /** Creates the owner account once the person proves the authenticator app works (a current 6-digit code). */
  async finish(input: { token: string; code: string; ip: string }): Promise<{ email: string }> {
    this.throttle(input.ip);
    if (!(await this.isOpen())) throw new SetupFailure("setup_closed");
    const now = this.clock();
    const entry = this.pending.get(input.token);
    if (!entry || entry.expiresAt < now.getTime()) {
      this.pending.delete(input.token);
      throw new SetupFailure("setup_expired");
    }
    if (verifyTotp(entry.secret, input.code.trim(), now.getTime(), null) === null) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_CODE_ATTEMPTS) this.pending.delete(input.token);
      throw new SetupFailure("invalid_totp");
    }

    this.pending.delete(input.token); // single use, taken before the first await below
    try {
      if (!(await this.isOpen())) throw new SetupFailure("setup_closed");
      const account = await this.auth.createAccount({ email: entry.email, password: entry.password, role: "owner", totpSecret: entry.secret });
      await this.store.audit({ actorEmail: account.email, action: "admin.first_run_setup", entity: "admin", entityId: account.id, at: now });
      return { email: account.email };
    } catch (error) {
      if (error instanceof AuthFailure && error.code === "weak_password") throw new SetupFailure("weak_password", undefined, error.issues);
      throw error;
    }
  }
}

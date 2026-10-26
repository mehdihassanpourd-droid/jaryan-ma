import type { RateLimiter } from "../auth/rate-limit";
import { newToken, parseCookies, sha256Hex, type CookieSettings } from "../auth/session";
import { OtpFailure, type OtpService } from "./otp-service";
import { DuplicateCustomerError, type CustomerPrincipal, type CustomerRecord, type CustomerStore } from "./ports";

export type CustomerAuthFailureCode = "invalid_code" | "terms_required" | "account_suspended" | "rate_limited" | "sms_unavailable";

export class CustomerAuthFailure extends Error {
  constructor(
    public code: CustomerAuthFailureCode,
    public retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "CustomerAuthFailure";
  }
}

export interface CustomerAuthSettings {
  sessionAbsoluteMs: number;
  sessionIdleMs: number;
  termsVersion: string;
  /** Code-check attempts per client address per 15 minutes (stops one machine guessing across many numbers). */
  verifyIpLimit: number;
}

export const DEFAULT_CUSTOMER_AUTH: CustomerAuthSettings = {
  sessionAbsoluteMs: 30 * 24 * 3600_000,
  sessionIdleMs: 14 * 24 * 3600_000,
  termsVersion: "2026-01",
  verifyIpLimit: 30,
};

export interface SignInResult {
  token: string;
  csrfToken: string;
  expiresAt: Date;
  customer: CustomerRecord;
  isNewCustomer: boolean;
  /** The customer asked to delete the account and is inside the grace period; the UI should offer to cancel. */
  pendingDeletion: boolean;
}

const asFailure = (error: unknown): never => {
  if (error instanceof OtpFailure) throw new CustomerAuthFailure(error.code, error.retryAfterSeconds);
  throw error;
};

export class CustomerAuthService {
  constructor(
    private readonly store: CustomerStore,
    private readonly otp: OtpService,
    private readonly limiter: RateLimiter,
    private readonly settings: CustomerAuthSettings = DEFAULT_CUSTOMER_AUTH,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async requestCode(phone: string, ip: string): Promise<{ retryAfterSeconds: number }> {
    try {
      return await this.otp.request(phone, ip);
    } catch (error) {
      return asFailure(error);
    }
  }

  async signIn(input: { phone: string; code: string; acceptTerms: boolean; ip: string; userAgent: string | null }): Promise<SignInResult> {
    const limited = this.limiter.hit(`customer-verify:${input.ip}`, this.settings.verifyIpLimit, 15 * 60_000);
    if (!limited.allowed) throw new CustomerAuthFailure("rate_limited", limited.retryAfterSeconds);

    let challengeId: string;
    try {
      challengeId = (await this.otp.check(input.phone, input.code)).challengeId;
    } catch (error) {
      return asFailure(error);
    }

    let customer = await this.store.findByPhone(input.phone);
    if (customer && (customer.status === "suspended" || customer.status === "anonymized")) throw new CustomerAuthFailure("account_suspended");
    // New numbers must accept the terms; the (valid) code is NOT consumed yet, so the person can simply retry.
    if (!customer && !input.acceptTerms) throw new CustomerAuthFailure("terms_required");

    if (!(await this.otp.consume(challengeId))) throw new CustomerAuthFailure("invalid_code");

    const now = this.clock();
    let isNewCustomer = false;
    if (!customer) {
      try {
        customer = await this.store.createCustomer({ phone: input.phone, termsVersion: this.settings.termsVersion, now });
        isNewCustomer = true;
      } catch (error) {
        if (!(error instanceof DuplicateCustomerError)) throw error;
        customer = await this.store.findByPhone(input.phone); // lost a registration race: the other request created it
        if (!customer) throw error;
      }
    }

    const token = newToken();
    const csrfToken = newToken(24);
    const expiresAt = new Date(now.getTime() + this.settings.sessionAbsoluteMs);
    await this.store.createSession({ customerId: customer.id, tokenHash: sha256Hex(token), csrfToken, createdAt: now, lastSeenAt: now, expiresAt, ip: input.ip, userAgent: input.userAgent?.slice(0, 300) ?? null });
    await this.store.touchLogin(customer.id, now);
    return { token, csrfToken, expiresAt, customer, isNewCustomer, pendingDeletion: customer.status === "pending_deletion" };
  }

  async signOut(principal: CustomerPrincipal): Promise<void> {
    await this.store.deleteSession(principal.sessionId);
  }

  /** Housekeeping for the scheduled job: expired sessions and old codes. */
  async purge(): Promise<{ sessions: number; otps: number }> {
    const now = this.clock();
    return { sessions: await this.store.purgeExpiredSessions(now), otps: await this.store.purgeOldOtps(new Date(now.getTime() - 7 * 24 * 3600_000)) };
  }
}

const TOUCH_INTERVAL_MS = 60_000;

/** Authenticates customer API requests by their session cookie. */
export class CustomerSessionAuthenticator {
  constructor(
    private readonly store: CustomerStore,
    private readonly cookie: CookieSettings,
    private readonly policy: { idleMs: number },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async authenticate(request: Request): Promise<CustomerPrincipal | null> {
    const token = parseCookies(request.headers.get("cookie")).get(this.cookie.name);
    if (!token || token.length > 200) return null;
    const session = await this.store.findSession(sha256Hex(token));
    if (!session) return null;

    const now = this.clock();
    const usable = session.customer.status === "active" || session.customer.status === "pending_deletion";
    if (session.expiresAt <= now || now.getTime() - session.lastSeenAt.getTime() > this.policy.idleMs || !usable) {
      await this.store.deleteSession(session.id);
      return null;
    }
    if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) await this.store.touchSession(session.id, now);
    return { customerId: session.customer.id, phone: session.customer.phone, sessionId: session.id, csrfToken: session.csrfToken, status: session.customer.status };
  }
}

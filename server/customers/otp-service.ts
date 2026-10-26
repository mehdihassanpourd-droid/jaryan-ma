import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { DEFAULT_OTP_POLICY, otpMessage, phoneSendDecision, type OtpPolicy } from "../../src/domain/customer/otp-policy";
import type { SmsProvider } from "../sms/provider";
import { SmsNotConfiguredError } from "../sms/provider";
import type { CustomerStore } from "./ports";

export type OtpFailureCode = "rate_limited" | "sms_unavailable" | "invalid_code";

export class OtpFailure extends Error {
  constructor(
    public code: OtpFailureCode,
    public retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "OtpFailure";
  }
}

/**
 * One-time sign-in codes. Security properties:
 * - the code comes from a CSPRNG and only a keyed hash (HMAC-SHA-256, key derived from the server secret) is stored;
 * - a code lives 5 minutes, allows 5 wrong guesses, and can be consumed exactly once (atomic);
 * - only the newest code for a number is valid;
 * - sends are limited per number, per client address and for the whole site (SMS-pumping/cost protection), counted
 *   in the database so the limits hold across restarts and instances;
 * - answers never reveal whether a number is already registered.
 */
export class OtpService {
  constructor(
    private readonly store: CustomerStore,
    private readonly sms: SmsProvider,
    private readonly key: Buffer,
    private readonly policy: OtpPolicy = DEFAULT_OTP_POLICY,
    private readonly clock: () => Date = () => new Date(),
    private readonly log: (event: string, detail?: Record<string, unknown>) => void = () => undefined,
  ) {}

  private hash(id: string, phone: string, code: string): string {
    return createHmac("sha256", this.key).update(`${id}|${phone}|${code}`).digest("hex");
  }

  /** Sends a code. Returns when the next one may be requested. */
  async request(phone: string, ip: string): Promise<{ retryAfterSeconds: number }> {
    const now = this.clock();

    if ((await this.store.countOtpsSince(new Date(now.getTime() - 24 * 3600_000))) >= this.policy.dailyBudget) {
      this.log("sms_budget_exhausted", { budget: this.policy.dailyBudget });
      throw new OtpFailure("sms_unavailable");
    }
    const byIp = await this.store.countOtpsByIp(ip, new Date(now.getTime() - this.policy.ipWindowMs));
    if (byIp >= this.policy.ipMax) throw new OtpFailure("rate_limited", Math.ceil(this.policy.ipWindowMs / 4000));

    const decision = phoneSendDecision(await this.store.recentOtpTimes(phone, new Date(now.getTime() - 24 * 3600_000)), now, this.policy);
    if (!decision.allowed) throw new OtpFailure("rate_limited", decision.retryAfterSeconds);

    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.store.invalidateOpenOtps(phone, now);
    await this.store.createOtp({ id, phone, codeHash: this.hash(id, phone, code), expiresAt: new Date(now.getTime() + this.policy.codeTtlMs), ip, now });

    try {
      const result = await this.sms.send({ to: phone, text: otpMessage(code) });
      await this.store.setOtpProviderMessageId(id, result.providerMessageId);
    } catch (error) {
      await this.store.invalidateOtp(id, now);
      this.log("sms_send_failed", { provider: this.sms.name, reason: error instanceof SmsNotConfiguredError ? "not_configured" : "delivery" });
      throw new OtpFailure("sms_unavailable");
    }
    return { retryAfterSeconds: Math.ceil(this.policy.cooldownMs / 1000) };
  }

  /**
   * Checks a code WITHOUT consuming it (so the caller can still ask for terms acceptance first). A wrong code
   * counts toward the attempt limit; the fifth wrong guess destroys the code. Every failure is the same
   * `invalid_code`, so nothing leaks about expiry, attempts or accounts.
   */
  async check(phone: string, code: string): Promise<{ challengeId: string }> {
    const now = this.clock();
    const challenge = await this.store.findActiveOtp(phone, now);
    if (!challenge) throw new OtpFailure("invalid_code");

    const expected = Buffer.from(challenge.codeHash, "hex");
    const given = Buffer.from(this.hash(challenge.id, phone, code), "hex");
    if (expected.length === given.length && timingSafeEqual(expected, given) && challenge.attempts < this.policy.maxAttempts) {
      return { challengeId: challenge.id };
    }
    const attempts = await this.store.recordOtpFailure(challenge.id);
    if (attempts >= this.policy.maxAttempts) await this.store.invalidateOtp(challenge.id, now);
    throw new OtpFailure("invalid_code");
  }

  /** Burns the code. True for exactly one caller, even if the same code is submitted concurrently. */
  consume(challengeId: string): Promise<boolean> {
    return this.store.consumeOtp(challengeId, this.clock());
  }
}

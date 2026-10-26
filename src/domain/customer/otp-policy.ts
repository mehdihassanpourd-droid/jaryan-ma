/** Pure rules for one-time sign-in codes: how long they live, how often they can be sent and guessed. */
export interface OtpPolicy {
  codeTtlMs: number;
  /** Wrong guesses allowed per code before it is destroyed. */
  maxAttempts: number;
  /** Minimum gap between two codes to the same number. */
  cooldownMs: number;
  windowMs: number;
  maxPerWindow: number;
  maxPerDay: number;
  /** Per client address: protects against one machine sweeping many numbers. */
  ipWindowMs: number;
  ipMax: number;
  /** Hard ceiling of codes per 24 h for the whole site: the structural defence against SMS-pumping bills. */
  dailyBudget: number;
}

export const DEFAULT_OTP_POLICY: OtpPolicy = {
  codeTtlMs: 5 * 60_000,
  maxAttempts: 5,
  cooldownMs: 60_000,
  windowMs: 15 * 60_000,
  maxPerWindow: 3,
  maxPerDay: 10,
  ipWindowMs: 60 * 60_000,
  ipMax: 20,
  dailyBudget: 300,
};

export type SendDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * Decides whether another code may be sent to a number, given the send times of the last 24 hours
 * (any order). When refused, `retryAfterSeconds` is when the *last* applicable limit lifts.
 */
export function phoneSendDecision(sentAt: Date[], now: Date, policy: OtpPolicy): SendDecision {
  const times = sentAt.map((d) => d.getTime()).sort((a, b) => b - a); // newest first
  const t = now.getTime();
  const waits: number[] = [];

  const newest = times[0];
  if (newest !== undefined && t - newest < policy.cooldownMs) waits.push(newest + policy.cooldownMs - t);

  const inWindow = times.filter((x) => t - x < policy.windowMs);
  const windowOldestCounted = inWindow[policy.maxPerWindow - 1];
  if (inWindow.length >= policy.maxPerWindow && windowOldestCounted !== undefined) waits.push(windowOldestCounted + policy.windowMs - t);

  const inDay = times.filter((x) => t - x < 24 * 3600_000);
  const dayOldestCounted = inDay[policy.maxPerDay - 1];
  if (inDay.length >= policy.maxPerDay && dayOldestCounted !== undefined) waits.push(dayOldestCounted + 24 * 3600_000 - t);

  return waits.length === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: seconds(Math.max(...waits)) };
}

/** SMS body. Short, Persian, says not to share the code. */
export function otpMessage(code: string): string {
  return `کد ورود شما به جریان ما: ${code}\nاین کد را به هیچ‌کس نگویید.`;
}

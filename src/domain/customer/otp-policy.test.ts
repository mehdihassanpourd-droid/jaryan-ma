import { describe, expect, it } from "vitest";
import { DEFAULT_OTP_POLICY as P, otpMessage, phoneSendDecision } from "./otp-policy";

const now = new Date("2026-03-01T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const min = (n: number) => n * 60_000;

describe("phoneSendDecision", () => {
  it("allows the first code", () => expect(phoneSendDecision([], now, P)).toEqual({ allowed: true }));

  it("enforces the cooldown between codes and reports the exact wait", () => {
    expect(phoneSendDecision([ago(20_000)], now, P)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    expect(phoneSendDecision([ago(60_000)], now, P)).toEqual({ allowed: true });
  });

  it("allows 3 per 15 minutes and then waits for the oldest to age out", () => {
    const three = [ago(min(2)), ago(min(5)), ago(min(9))];
    expect(phoneSendDecision(three, now, P)).toEqual({ allowed: false, retryAfterSeconds: 6 * 60 }); // oldest (9 min) leaves the window in 6 min
    expect(phoneSendDecision([ago(min(2)), ago(min(5)), ago(min(16))], now, P)).toEqual({ allowed: true });
  });

  it("enforces the daily cap", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ago(min(30 + i * 100)));
    const decision = phoneSendDecision(ten, now, P);
    expect(decision.allowed).toBe(false);
    expect(!decision.allowed && decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(phoneSendDecision(ten.slice(1), now, P)).toEqual({ allowed: true });
  });

  it("is independent of the order of the input and ignores old sends", () => {
    expect(phoneSendDecision([ago(min(9)), ago(min(2)), ago(min(5))], now, P)).toEqual(phoneSendDecision([ago(min(2)), ago(min(5)), ago(min(9))], now, P));
    expect(phoneSendDecision([ago(25 * 3600_000)], now, P)).toEqual({ allowed: true });
  });
});

describe("policy defaults", () => {
  it("are conservative", () => {
    expect(P).toMatchObject({ codeTtlMs: 300_000, maxAttempts: 5, maxPerWindow: 3, maxPerDay: 10, dailyBudget: 300 });
  });
  it("puts the code and a warning in the message", () => {
    const text = otpMessage("123456");
    expect(text).toContain("123456");
    expect(text).toContain("به هیچ‌کس نگویید");
  });
});

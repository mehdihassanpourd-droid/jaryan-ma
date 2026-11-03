// Cost guard. IMPORTANT: nothing here relies on the wallet balance. Whether ArvanCloud stops or suspends a server when the
// wallet is empty has NOT been verified, so a limited wallet is never treated as a spending ceiling. The ceiling is enforced by
// software: a hard time limit written into the resource NAME (so no state has to be stored anywhere) and an independent sweeper.
export const PREFIX = "jm-probe-";
export const HARD_MAX_HOURS = 168; // never more than 7 days, whatever is typed
export const MAX_SANE_RATE_IRR = 200000; // typo guard for the hourly price (owner reported 13,860)
export const CONFIRM_PHRASE = "I-APPROVE-SPEND";

export function validatePlan({ hourlyRateIrr, maxHours, extraIrrPerHour = 0, confirm }) {
  const errors = [];
  if (!Number.isFinite(hourlyRateIrr) || hourlyRateIrr <= 0 || hourlyRateIrr > MAX_SANE_RATE_IRR) errors.push(`hourly rate must be between 1 and ${MAX_SANE_RATE_IRR} IRR`);
  if (!Number.isInteger(maxHours) || maxHours < 1 || maxHours > HARD_MAX_HOURS) errors.push(`max hours must be a whole number from 1 to ${HARD_MAX_HOURS}`);
  if (!Number.isFinite(extraIrrPerHour) || extraIrrPerHour < 0) errors.push("extra hourly cost must be 0 or more");
  if (confirm !== CONFIRM_PHRASE) errors.push(`the confirmation phrase must be exactly ${CONFIRM_PHRASE}`);
  return errors;
}

/** Upper bound the SOFTWARE enforces, with a 10% margin for rounding up to whole hours; extras that are unknown are only what the caller passes. */
export function costCeiling({ hourlyRateIrr, maxHours, extraIrrPerHour = 0 }) {
  const hours = maxHours + 1; // a started hour is billed as a whole hour (assumption)
  return Math.ceil((hourlyRateIrr + extraIrrPerHour) * hours * 1.1);
}

export function estimateCost({ hourlyRateIrr, extraIrrPerHour = 0 }, elapsedMs) {
  const hours = Math.max(1, Math.ceil(elapsedMs / 3600000));
  return (hourlyRateIrr + extraIrrPerHour) * hours;
}

export function makeName(runId, expiresAtMs, kind = "") {
  if (!/^[a-z0-9]{4,16}$/.test(runId)) throw new Error("invalid run id");
  return `${PREFIX}${runId}-x${Math.floor(expiresAtMs / 1000)}${kind ? `-${kind}` : ""}`;
}

/** Returns { ours, expiresAtMs|null }. A name with our prefix but no readable expiry is treated as already expired (fail closed). */
export function parseName(name) {
  if (typeof name !== "string" || !name.startsWith(PREFIX)) return { ours: false, expiresAtMs: null };
  const m = /^jm-probe-[a-z0-9]{4,16}-x(\d{9,11})(?:-[a-z]+)?$/.exec(name);
  return { ours: true, expiresAtMs: m ? Number(m[1]) * 1000 : null };
}

export function isExpired(name, nowMs) {
  const p = parseName(name);
  return p.ours && (p.expiresAtMs === null || nowMs >= p.expiresAtMs);
}

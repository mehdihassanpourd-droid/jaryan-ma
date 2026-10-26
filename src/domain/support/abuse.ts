import { fixPersianLetters, toLatinDigits } from "../persian";

export interface SupportLimits {
  /** Tickets one customer may open per hour / per day. */
  ticketsPerHour: number;
  ticketsPerDay: number;
  /** Tickets not yet resolved/closed at the same time. */
  maxOpenTickets: number;
  /** Customer messages (new tickets included) per hour. */
  messagesPerHour: number;
  /** Links allowed in one message. */
  maxLinks: number;
  /** An identical message from the same customer inside this window is refused as a duplicate. */
  duplicateWindowMs: number;
}

export const DEFAULT_SUPPORT_LIMITS: SupportLimits = {
  ticketsPerHour: 3,
  ticketsPerDay: 8,
  maxOpenTickets: 10,
  messagesPerHour: 20,
  maxLinks: 2,
  duplicateWindowMs: 24 * 3600_000,
};

const URL_RE = /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|[a-z0-9-]+\.(?:com|net|org|ir|io|info|xyz|top|click|me)\b)[^\s]*/gi;

export function countLinks(text: string): number {
  return (text.match(URL_RE) ?? []).length;
}

/** Control characters and bidi overrides that can spoof or break rendering are removed; blank runs are collapsed. */
export function cleanMessageBody(input: string): string {
  return fixPersianLetters(input)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Canonical form for duplicate detection: digits, letters, case and spacing differences do not matter. */
export function normalizeForDuplicate(body: string): string {
  return toLatinDigits(fixPersianLetters(body))
    .toLowerCase()
    .replace(/[\s‌‏‎.,،؛!؟?\-_]+/g, " ")
    .trim();
}

export type SpamVerdict = { spam: false } | { spam: true; reason: "too_many_links" | "repetitive" | "too_short" };

/** Cheap structural checks (no AI, no external service). */
export function assessMessage(body: string, limits: SupportLimits = DEFAULT_SUPPORT_LIMITS): SpamVerdict {
  if (countLinks(body) > limits.maxLinks) return { spam: true, reason: "too_many_links" };
  const compact = normalizeForDuplicate(body).replace(/\s/g, "");
  if (compact.length < 3) return { spam: true, reason: "too_short" };
  // "aaaaaaaaaaaa", "abababababab": a handful of distinct characters across a long message.
  if (compact.length >= 20 && new Set(compact).size <= 3) return { spam: true, reason: "repetitive" };
  // A single character making up most of a long message.
  const counts = new Map<string, number>();
  for (const ch of compact) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  if (compact.length >= 30 && Math.max(...counts.values()) / compact.length > 0.6) return { spam: true, reason: "repetitive" };
  return { spam: false };
}

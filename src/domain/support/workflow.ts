import type { TicketStatus } from "./types";

/** A resolved ticket may be reopened by the customer replying within this many days; after that they open a new one. */
export const CUSTOMER_REOPEN_DAYS = 14;
/** Resolved tickets with no further reply are closed automatically after this many days. */
export const AUTO_CLOSE_DAYS = 7;

/**
 * Staff status changes. A closed ticket can only be reopened (never edited sideways),
 * and a ticket cannot jump to its current state.
 */
const STAFF_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ["in_progress", "waiting_customer", "resolved", "closed"],
  in_progress: ["open", "waiting_customer", "resolved", "closed"],
  waiting_customer: ["open", "in_progress", "resolved", "closed"],
  resolved: ["open", "in_progress", "closed"],
  closed: ["open"],
};

export function canStaffTransition(from: TicketStatus, to: TicketStatus): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

export type CustomerReplyDecision = { ok: true; status: TicketStatus } | { ok: false; reason: "closed" | "reopen_expired" };

/** What happens when the customer writes on a ticket. */
export function onCustomerReply(status: TicketStatus, resolvedAt: Date | null, now: Date): CustomerReplyDecision {
  if (status === "closed") return { ok: false, reason: "closed" };
  if (status === "resolved") {
    const expired = resolvedAt !== null && now.getTime() - resolvedAt.getTime() > CUSTOMER_REOPEN_DAYS * 24 * 3600_000;
    return expired ? { ok: false, reason: "reopen_expired" } : { ok: true, status: "open" };
  }
  // The customer answered what staff asked: staff must look again.
  if (status === "waiting_customer") return { ok: true, status: "open" };
  return { ok: true, status };
}

/** Staff reply: the ball is in the customer's court unless the staff member says otherwise. Closed tickets are read-only. */
export function onStaffReply(status: TicketStatus, requested?: TicketStatus): TicketStatus | null {
  if (status === "closed") return null;
  if (requested && requested !== status) return canStaffTransition(status, requested) ? requested : null;
  return requested ?? "waiting_customer";
}

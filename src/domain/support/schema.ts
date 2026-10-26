import { z } from "zod";
import { fixPersianLetters } from "../persian";
import { cleanMessageBody } from "./abuse";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES } from "./types";

export const MAX_MESSAGE_LENGTH = 4000;

const message = (min = 2) => z.string().max(MAX_MESSAGE_LENGTH * 2).transform(cleanMessageBody).pipe(z.string().min(min).max(MAX_MESSAGE_LENGTH));
const subject = z
  .string()
  .max(300)
  .transform((v) => fixPersianLetters(v).replace(/\s+/g, " ").trim())
  .pipe(z.string().min(3).max(120));

export const ticketCreateSchema = z
  .object({
    subject,
    category: z.enum(TICKET_CATEGORIES).default("other"),
    body: message(10),
    /** The customer-facing order number (e.g. 100001 for JM-100001); must be the customer's own. */
    orderNumber: z.number().int().min(1).max(2_000_000_000).optional(),
  })
  .strict();
export type TicketCreateInput = z.output<typeof ticketCreateSchema>;

export const customerReplySchema = z.object({ body: message() }).strict();
export const staffReplySchema = z.object({ body: message(), status: z.enum(TICKET_STATUSES).optional() }).strict();
export const noteSchema = z.object({ body: message(1) }).strict();

export const ticketUpdateSchema = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    /** Admin user id, or null to unassign. */
    assignedToId: z.string().min(1).max(64).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "empty_update");
export type TicketUpdate = z.output<typeof ticketUpdateSchema>;

export const ticketListQuerySchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
  category: z.enum(TICKET_CATEGORIES).optional(),
  assignedToId: z.string().min(1).max(64).optional(),
  unassigned: z.enum(["1"]).optional(),
  /** Ticket number (T-1042 / 1042 / 42) or a subject word. */
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TicketListQuery = z.output<typeof ticketListQuerySchema>;

export const faqCategorySchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
    title: z.string().trim().min(2).max(80).transform(fixPersianLetters),
    position: z.number().int().min(0).max(1000).default(0),
  })
  .strict();

export const faqItemSchema = z
  .object({
    categorySlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
    question: z.string().trim().min(5).max(200).transform(fixPersianLetters),
    answer: z.string().max(5000).transform(cleanMessageBody).pipe(z.string().min(5).max(3000)),
    position: z.number().int().min(0).max(1000).default(0),
    published: z.boolean().default(false),
  })
  .strict();
export type FaqItemInput = z.output<typeof faqItemSchema>;

/** "T-1042", "1042" or "42"-style input -> internal ticket number, or null for free text. */
export function parseTicketNumber(input: string): number | null {
  const m = /^\s*(?:T-?)?(\d{1,10})\s*$/i.exec(input);
  if (!m?.[1]) return null;
  const shown = Number(m[1]);
  // Displayed numbers are 1000 + internal number (formatTicketNumber); a bare small number is the internal one.
  return shown > 1000 ? shown - 1000 : shown;
}

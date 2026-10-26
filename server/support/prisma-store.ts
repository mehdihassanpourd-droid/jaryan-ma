import { maskPhone } from "../../src/domain/phone";
import type { TicketListQuery } from "../../src/domain/support/schema";
import { parseTicketNumber } from "../../src/domain/support/schema";
import { TICKET_STATUSES, type TicketStatus } from "../../src/domain/support/types";
import { Prisma } from "../../src/generated/prisma/client";
import type { Db } from "../db/client";
import type { CustomerTicketSummary, CustomerTicketView, FaqCategoryView, MessageView, StaffTicketDetail, SupportStore, TicketHeader, TicketRow } from "./ports";

const TX = { timeout: 30_000, maxWait: 10_000 };

const HEADER = { id: true, number: true, status: true, resolvedAt: true, firstResponseAt: true, assignedToId: true } as const;

const ROW_INCLUDE = {
  customer: { select: { phone: true } },
  order: { select: { number: true } },
  assignedTo: { select: { email: true } },
} satisfies Prisma.SupportTicketInclude;
type RowPayload = Prisma.SupportTicketGetPayload<{ include: typeof ROW_INCLUDE }>;

const toRow = (t: RowPayload): TicketRow => ({
  id: t.id, number: t.number, customerId: t.customerId, customerPhoneMasked: maskPhone(t.customer.phone), orderNumber: t.order?.number ?? null,
  subject: t.subject, category: t.category, status: t.status, priority: t.priority, assignedToId: t.assignedToId, assignedToEmail: t.assignedTo?.email ?? null,
  createdAt: t.createdAt, lastMessageAt: t.lastMessageAt, lastCustomerMessageAt: t.lastCustomerMessageAt, firstResponseAt: t.firstResponseAt, resolvedAt: t.resolvedAt,
});

const toMessage = (m: { id: string; author: "customer" | "staff" | "system"; body: string; createdAt: Date }): MessageView => ({ id: m.id, author: m.author, body: m.body, createdAt: m.createdAt });

// Customer-facing queries select explicit columns: notes, assignee and staff identities are never loaded.
const CUSTOMER_SELECT = {
  number: true, subject: true, category: true, status: true, createdAt: true, lastMessageAt: true, order: { select: { number: true } },
} satisfies Prisma.SupportTicketSelect;

const toSummary = (t: Prisma.SupportTicketGetPayload<{ select: typeof CUSTOMER_SELECT }>): CustomerTicketSummary => ({
  number: t.number, subject: t.subject, category: t.category, status: t.status, orderNumber: t.order?.number ?? null, createdAt: t.createdAt, lastMessageAt: t.lastMessageAt,
});

/**
 * Keeps resolvedAt/closedAt consistent with the status (the database CHECK constraints require it):
 * resolved and closed tickets have a resolution time, only closed ones have a closing time, reopening clears both.
 */
function statusTimes(status: TicketStatus, resolvedAt: Date | null, now: Date) {
  if (status === "resolved") return { status, resolvedAt: now, closedAt: null };
  if (status === "closed") return { status, resolvedAt: resolvedAt ?? now, closedAt: now };
  return { status, resolvedAt: null, closedAt: null };
}

export class PrismaSupportStore implements SupportStore {
  constructor(private readonly db: Db) {}

  // ---- customer side -------------------------------------------------------------------------

  async ownedOrderId(customerId: string, orderNumber: number) {
    return (await this.db.order.findFirst({ where: { customerId, number: orderNumber }, select: { id: true } }))?.id ?? null;
  }

  countTicketsSince(customerId: string, since: Date) {
    return this.db.supportTicket.count({ where: { customerId, createdAt: { gte: since } } });
  }

  countUnfinishedTickets(customerId: string) {
    return this.db.supportTicket.count({ where: { customerId, status: { in: ["open", "in_progress", "waiting_customer"] } } });
  }

  countCustomerMessagesSince(customerId: string, since: Date) {
    return this.db.supportMessage.count({ where: { author: "customer", createdAt: { gte: since }, ticket: { customerId } } });
  }

  async hasRecentDuplicate(customerId: string, duplicateKey: string, since: Date) {
    return (await this.db.supportTicket.count({ where: { customerId, duplicateKey, createdAt: { gte: since } } })) > 0;
  }

  async createTicket(data: Parameters<SupportStore["createTicket"]>[0]): Promise<CustomerTicketView> {
    const t = await this.db.supportTicket.create({
      data: {
        customerId: data.customerId, orderId: data.orderId, subject: data.subject, category: data.category, duplicateKey: data.duplicateKey,
        createdAt: data.now, updatedAt: data.now, lastMessageAt: data.now, lastCustomerMessageAt: data.now,
        messages: { create: { author: "customer", body: data.body, createdAt: data.now } },
      },
      select: { ...CUSTOMER_SELECT, messages: { orderBy: { createdAt: "asc" }, select: { id: true, author: true, body: true, createdAt: true } } },
    });
    return { ...toSummary(t), messages: t.messages.map(toMessage) };
  }

  async listCustomerTickets(customerId: string, page: number, pageSize: number) {
    const [rows, total] = await this.db.$transaction([
      this.db.supportTicket.findMany({ where: { customerId }, orderBy: { lastMessageAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, select: CUSTOMER_SELECT }),
      this.db.supportTicket.count({ where: { customerId } }),
    ]);
    return { items: rows.map(toSummary), total };
  }

  async getCustomerTicket(customerId: string, number: number) {
    const t = await this.db.supportTicket.findFirst({
      where: { customerId, number },
      select: { ...CUSTOMER_SELECT, messages: { orderBy: { createdAt: "asc" }, select: { id: true, author: true, body: true, createdAt: true } } },
    });
    return t ? { ...toSummary(t), messages: t.messages.map(toMessage) } : null;
  }

  customerTicketHeader(customerId: string, number: number): Promise<TicketHeader | null> {
    return this.db.supportTicket.findFirst({ where: { customerId, number }, select: HEADER });
  }

  async addCustomerMessage(ticketId: string, body: string, status: TicketStatus, now: Date) {
    await this.db.$transaction(async (tx) => {
      await tx.supportMessage.create({ data: { ticketId, author: "customer", body, createdAt: now } });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { status, lastMessageAt: now, lastCustomerMessageAt: now, updatedAt: now, resolvedAt: status === "resolved" ? undefined : null, closedAt: null },
      });
    }, TX);
  }

  async lastCustomerMessageBody(ticketId: string) {
    return (await this.db.supportMessage.findFirst({ where: { ticketId, author: "customer" }, orderBy: { createdAt: "desc" }, select: { body: true } }))?.body ?? null;
  }

  async exportForCustomer(customerId: string) {
    const rows = await this.db.supportTicket.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
      select: { ...CUSTOMER_SELECT, messages: { orderBy: { createdAt: "asc" }, select: { author: true, body: true, createdAt: true } } },
    });
    return rows.map((t) => ({ ...toSummary(t), messages: t.messages }));
  }

  // ---- staff side ----------------------------------------------------------------------------

  async listTickets(q: TicketListQuery) {
    const where: Prisma.SupportTicketWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.priority ? { priority: q.priority } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.assignedToId ? { assignedToId: q.assignedToId } : {}),
      ...(q.unassigned ? { assignedToId: null } : {}),
    };
    if (q.q) {
      const number = parseTicketNumber(q.q);
      const term = q.q.replace(/[%_\\]/g, "");
      const or: Prisma.SupportTicketWhereInput[] = [...(number !== null ? [{ number }] : []), ...(term ? [{ subject: { contains: term, mode: "insensitive" as const } }] : [])];
      if (or.length > 0) where.OR = or; // an empty OR would match nothing
    }
    const [rows, total] = await this.db.$transaction([
      this.db.supportTicket.findMany({
        where,
        include: ROW_INCLUDE,
        // Urgent first, then oldest customer wait first.
        orderBy: [{ priority: "desc" }, { lastMessageAt: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.supportTicket.count({ where }),
    ]);
    return { items: rows.map(toRow), total };
  }

  async getStaffTicket(number: number): Promise<StaffTicketDetail | null> {
    const t = await this.db.supportTicket.findUnique({ where: { number }, include: ROW_INCLUDE });
    if (!t) return null;
    const [messages, notes] = await Promise.all([
      this.db.supportMessage.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" } }),
      this.db.supportNote.findMany({ where: { ticketId: t.id }, orderBy: { createdAt: "asc" }, include: { admin: { select: { email: true } } } }),
    ]);
    const admins = await this.db.adminUser.findMany({ where: { id: { in: [...new Set(messages.map((m) => m.adminId).filter((x): x is string => !!x))] } }, select: { id: true, email: true } });
    const emailById = new Map(admins.map((a) => [a.id, a.email]));
    return {
      ...toRow(t),
      messages: messages.map((m) => ({ ...toMessage(m), adminEmail: m.adminId ? (emailById.get(m.adminId) ?? null) : null })),
      notes: notes.map((n) => ({ id: n.id, adminEmail: n.admin.email, body: n.body, createdAt: n.createdAt })),
    };
  }

  staffTicketHeader(number: number): Promise<TicketHeader | null> {
    return this.db.supportTicket.findUnique({ where: { number }, select: HEADER });
  }

  async addStaffMessage(ticketId: string, adminId: string, body: string, status: TicketStatus, now: Date) {
    await this.db.$transaction(async (tx) => {
      await tx.supportMessage.create({ data: { ticketId, author: "staff", adminId, body, createdAt: now } });
      const current = await tx.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, select: { firstResponseAt: true, assignedToId: true, resolvedAt: true } });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: now, updatedAt: now,
          firstResponseAt: current.firstResponseAt ?? now,
          // Whoever answers first takes the ticket.
          assignedToId: current.assignedToId ?? adminId,
          ...statusTimes(status, current.resolvedAt, now),
        },
      });
    }, TX);
  }

  async addNote(ticketId: string, adminId: string, body: string, now: Date) {
    await this.db.supportNote.create({ data: { ticketId, adminId, body, createdAt: now } });
  }

  async updateTicket(ticketId: string, patch: Parameters<SupportStore["updateTicket"]>[1], now: Date) {
    if (patch.assignedToId) {
      const admin = await this.db.adminUser.findFirst({ where: { id: patch.assignedToId, disabled: false, role: { in: ["support", "owner"] } }, select: { id: true } });
      if (!admin) return false;
    }
    await this.db.$transaction(async (tx) => {
      const current = await tx.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, select: { resolvedAt: true } });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          ...(patch.priority ? { priority: patch.priority } : {}),
          ...(patch.assignedToId !== undefined ? { assignedToId: patch.assignedToId } : {}),
          ...(patch.status ? statusTimes(patch.status, current.resolvedAt, now) : {}),
          updatedAt: now,
        },
      });
    }, TX);
    return true;
  }

  async closeResolvedBefore(before: Date, now: Date) {
    return (await this.db.supportTicket.updateMany({ where: { status: "resolved", resolvedAt: { lt: before } }, data: { status: "closed", closedAt: now, updatedAt: now } })).count;
  }

  async countByStatus() {
    const groups = await this.db.supportTicket.groupBy({ by: ["status"], _count: { _all: true } });
    const out = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0])) as Record<TicketStatus, number>;
    for (const g of groups) out[g.status] = g._count._all;
    return out;
  }

  // ---- FAQ -----------------------------------------------------------------------------------

  async listPublishedFaq(): Promise<FaqCategoryView[]> {
    const cats = await this.db.faqCategory.findMany({
      orderBy: [{ position: "asc" }, { title: "asc" }],
      include: { items: { where: { published: true }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { slug: true, question: true, answer: true } } },
    });
    return cats.filter((c) => c.items.length > 0).map((c) => ({ slug: c.slug, title: c.title, items: c.items }));
  }

  async listAllFaq() {
    const [cats, items] = await Promise.all([
      this.db.faqCategory.findMany({ orderBy: [{ position: "asc" }, { title: "asc" }] }),
      this.db.faqItem.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], include: { category: { select: { slug: true } } } }),
    ]);
    return {
      categories: cats.map((c) => ({ slug: c.slug, title: c.title, position: c.position })),
      items: items.map((i) => ({ slug: i.slug, question: i.question, answer: i.answer, categorySlug: i.category.slug, position: i.position, published: i.published, updatedAt: i.updatedAt })),
    };
  }

  async upsertFaqCategory(data: { slug: string; title: string; position: number }) {
    await this.db.faqCategory.upsert({ where: { slug: data.slug }, update: { title: data.title, position: data.position }, create: data });
  }

  async insertFaqCategoryIfAbsent(data: { slug: string; title: string; position: number }) {
    await this.db.faqCategory.createMany({ data: [data], skipDuplicates: true });
  }

  async upsertFaqItem(data: Parameters<SupportStore["upsertFaqItem"]>[0], now: Date) {
    const category = await this.db.faqCategory.findUnique({ where: { slug: data.categorySlug }, select: { id: true } });
    if (!category) return false;
    const fields = { categoryId: category.id, question: data.question, answer: data.answer, position: data.position, published: data.published, updatedAt: now };
    await this.db.faqItem.upsert({ where: { slug: data.slug }, update: fields, create: { slug: data.slug, ...fields, createdAt: now } });
    return true;
  }

  async insertFaqItemIfAbsent(data: Parameters<SupportStore["upsertFaqItem"]>[0], now: Date) {
    const category = await this.db.faqCategory.findUnique({ where: { slug: data.categorySlug }, select: { id: true } });
    if (!category) return false;
    const r = await this.db.faqItem.createMany({
      data: [{ slug: data.slug, categoryId: category.id, question: data.question, answer: data.answer, position: data.position, published: data.published, createdAt: now, updatedAt: now }],
      skipDuplicates: true,
    });
    return r.count === 1;
  }

  async deleteFaqItem(slug: string) {
    return (await this.db.faqItem.deleteMany({ where: { slug } })).count > 0;
  }
}

import { describe, expect, it } from "vitest";
import { DEFAULT_SUPPORT_LIMITS, assessMessage, cleanMessageBody, countLinks, normalizeForDuplicate } from "./abuse";
import { customerReplySchema, faqItemSchema, noteSchema, parseTicketNumber, staffReplySchema, ticketCreateSchema, ticketListQuerySchema, ticketUpdateSchema } from "./schema";
import { canStaffTransition, onCustomerReply, onStaffReply } from "./workflow";

describe("ticket creation schema", () => {
  const ok = { subject: "  مشکل   در پیگیری سفارش ", body: "سفارش من هنوز نرسیده است لطفا بررسی کنید", category: "order", orderNumber: 100001 };

  it("normalises text and applies defaults", () => {
    expect(ticketCreateSchema.parse({ ...ok, category: undefined })).toMatchObject({ subject: "مشکل در پیگیری سفارش", category: "other" });
    expect(ticketCreateSchema.parse({ ...ok, subject: "كتاب ي" }).subject).toBe("کتاب ی");
  });

  it("rejects short, long, unknown and extra fields", () => {
    expect(ticketCreateSchema.safeParse({ ...ok, body: "کوتاه" }).success).toBe(false);
    expect(ticketCreateSchema.safeParse({ ...ok, subject: "ab" }).success).toBe(false);
    expect(ticketCreateSchema.safeParse({ ...ok, body: "الف".repeat(4001) }).success).toBe(false);
    expect(ticketCreateSchema.safeParse({ ...ok, category: "hack" }).success).toBe(false);
    expect(ticketCreateSchema.safeParse({ ...ok, status: "closed" }).success).toBe(false); // customers cannot set status/priority
    expect(ticketCreateSchema.safeParse({ ...ok, priority: "urgent" }).success).toBe(false);
    expect(ticketCreateSchema.safeParse({ ...ok, orderNumber: -1 }).success).toBe(false);
  });

  it("strips control and bidi-override characters from messages", () => {
    expect(customerReplySchema.parse({ body: "سلام‮\u0000 دنیا\r\n\r\n\r\n\r\nتمام" }).body).toBe("سلام دنیا\n\nتمام");
    expect(cleanMessageBody("a \t\nb")).toBe("a\nb");
  });
});

describe("staff schemas", () => {
  it("validates updates strictly", () => {
    expect(ticketUpdateSchema.parse({ priority: "high", assignedToId: null })).toEqual({ priority: "high", assignedToId: null });
    expect(ticketUpdateSchema.safeParse({}).success).toBe(false);
    expect(ticketUpdateSchema.safeParse({ status: "weird" }).success).toBe(false);
    expect(ticketUpdateSchema.safeParse({ customerId: "x", status: "open" }).success).toBe(false);
    expect(staffReplySchema.safeParse({ body: "پاسخ", status: "resolved" }).success).toBe(true);
    expect(noteSchema.safeParse({ body: "" }).success).toBe(false);
  });

  it("parses list queries with bounds", () => {
    expect(ticketListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(ticketListQuerySchema.safeParse({ pageSize: "1000" }).success).toBe(false);
    expect(ticketListQuerySchema.safeParse({ status: "nope" }).success).toBe(false);
  });

  it("recognises displayed ticket numbers", () => {
    expect(parseTicketNumber("T-1042")).toBe(42);
    expect(parseTicketNumber("t1042")).toBe(42);
    expect(parseTicketNumber("1042")).toBe(42);
    expect(parseTicketNumber("42")).toBe(42);
    expect(parseTicketNumber("سفارش")).toBeNull();
  });
});

describe("FAQ schema", () => {
  it("requires valid slugs and defaults to unpublished", () => {
    const item = { categorySlug: "shipping", slug: "delivery-time", question: "ارسال چقدر طول می‌کشد؟", answer: "این بخش بعد از تعیین سیاست ارسال تکمیل می‌شود." };
    expect(faqItemSchema.parse(item)).toMatchObject({ published: false, position: 0 });
    expect(faqItemSchema.safeParse({ ...item, slug: "Bad Slug" }).success).toBe(false);
    expect(faqItemSchema.safeParse({ ...item, answer: "x".repeat(3001) }).success).toBe(false);
  });
});

describe("workflow", () => {
  it("limits staff transitions", () => {
    expect(canStaffTransition("open", "resolved")).toBe(true);
    expect(canStaffTransition("open", "open")).toBe(false);
    expect(canStaffTransition("closed", "resolved")).toBe(false);
    expect(canStaffTransition("closed", "open")).toBe(true);
  });

  it("decides what a customer reply does", () => {
    const now = new Date("2026-03-20T00:00:00Z");
    expect(onCustomerReply("closed", null, now)).toEqual({ ok: false, reason: "closed" });
    expect(onCustomerReply("waiting_customer", null, now)).toEqual({ ok: true, status: "open" });
    expect(onCustomerReply("in_progress", null, now)).toEqual({ ok: true, status: "in_progress" });
    expect(onCustomerReply("resolved", new Date("2026-03-10T00:00:00Z"), now)).toEqual({ ok: true, status: "open" });
    expect(onCustomerReply("resolved", new Date("2026-02-01T00:00:00Z"), now)).toEqual({ ok: false, reason: "reopen_expired" });
  });

  it("decides what a staff reply does", () => {
    expect(onStaffReply("open")).toBe("waiting_customer");
    expect(onStaffReply("open", "resolved")).toBe("resolved");
    expect(onStaffReply("in_progress", "in_progress")).toBe("in_progress");
    expect(onStaffReply("closed")).toBeNull();
    expect(onStaffReply("resolved", "waiting_customer")).toBeNull();
  });
});

describe("abuse rules", () => {
  it("counts links", () => {
    expect(countLinks("سلام")).toBe(0);
    expect(countLinks("https://a.example.com/x و www.b.ir و t.me/foo")).toBe(3);
    expect(countLinks("shop.com")).toBe(1);
  });

  it("flags spam structurally but lets normal Persian text through", () => {
    const L = DEFAULT_SUPPORT_LIMITS;
    expect(assessMessage("سفارش من هنوز نرسیده و می‌خواهم پیگیری کنم", L)).toEqual({ spam: false });
    expect(assessMessage("ببینید http://a.com http://b.com http://c.com", L)).toEqual({ spam: true, reason: "too_many_links" });
    expect(assessMessage("ااااااااااااااااااااااااااااااا", L)).toEqual({ spam: true, reason: "repetitive" });
    expect(assessMessage("abababababababababababab", L)).toEqual({ spam: true, reason: "repetitive" });
    expect(assessMessage("..", L)).toEqual({ spam: true, reason: "too_short" });
  });

  it("treats cosmetic differences as the same message", () => {
    expect(normalizeForDuplicate("سفارش ۱۲۳  من، كجاست؟")).toBe(normalizeForDuplicate("سفارش 123 من کجاست"));
  });
});

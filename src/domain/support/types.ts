export const TICKET_STATUSES = ["open", "in_progress", "waiting_customer", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_CATEGORIES = ["order", "product", "shipping", "returns", "account", "website", "other"] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_CATEGORY_LABELS: Record<TicketCategory, string> = {
  order: "سفارش",
  product: "محصول",
  shipping: "ارسال",
  returns: "مرجوعی",
  account: "حساب کاربری",
  website: "مشکل در سایت",
  other: "سایر",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "باز",
  in_progress: "در حال بررسی",
  waiting_customer: "منتظر پاسخ شما",
  resolved: "حل‌شده",
  closed: "بسته",
};

export const TICKET_PRIORITY_LABELS: Record<TicketPriority, string> = { low: "کم", normal: "عادی", high: "زیاد", urgent: "فوری" };

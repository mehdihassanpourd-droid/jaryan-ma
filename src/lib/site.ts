import { ORDER_API_BASE } from "@/lib/order-config";

/**
 * REAL business information. Only the brand name, slogan, Instagram account and the
 * owner's own description of the brand (a curated home decor & handicrafts gallery, see
 * `focusAreas`) are confirmed. Everything else is unknown and must stay `null` (the UI then
 * shows a clearly marked placeholder) until the gallery supplies it.
 */
export const site = {
  name: "جریان ما",
  slogan: "اینجا هنر در جریان است",
  description:
    "جریان ما گالری گزینش‌شدهٔ دکوراسیون خانه و هنرهای دست‌ساز است: سفال و سرامیک، هنر نساجی، اشیای تزئینی و آثار هنری یگانه برای زندگی روزمره.",
  instagramHandle: "jaryan.ma",
  instagramUrl: "https://instagram.com/jaryan.ma",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
  /** Not provided yet. Do not invent values; fill in only what the owner confirms. */
  contact: {
    phone: null as string | null,
    email: null as string | null,
    address: null as string | null,
  },
} as const;

/**
 * What the gallery curates, as the owner described it. The first three collections in the catalogue are only a beginning:
 * nothing in navigation, SEO or code is limited to them (collections come from the catalogue data).
 */
export const focusAreas = ["دکور دست‌ساز خانه", "هنر تزئینی", "سفال و سرامیک", "هنر نساجی", "اکسسوری دست‌ساز", "اشیای هنری یگانه"] as const;

const baseNavLinks = [
  { href: "/#collections", label: "مجموعه‌ها" },
  { href: "/#featured", label: "منتخب‌ها" },
  { href: "/#story", label: "داستان" },
  { href: "/#artists", label: "هنرمندان" },
  { href: "/#trust", label: "اطلاعات خرید" },
  { href: "/#contact", label: "تماس" },
] as const;

/** "My orders" exists only where the store has an order system to read them from. */
export const navLinks: ReadonlyArray<{ readonly href: string; readonly label: string }> = ORDER_API_BASE ? [...baseNavLinks, { href: "/orders", label: "سفارش‌های من" }] : baseNavLinks;

import { ORDER_API_BASE } from "@/lib/order-config";

/**
 * REAL business information. Only the brand name, slogan and Instagram account
 * are confirmed. Everything else is unknown and must stay `null` (the UI then
 * shows a clearly marked placeholder) until the gallery supplies it.
 */
export const site = {
  name: "جریان ما",
  slogan: "اینجا هنر در جریان است",
  description:
    "گالری و فروشگاه آثار هنری دست‌ساز ایرانی؛ کیف‌های پارچه‌ای نقاشی‌دست، ماندالای قلاب‌بافی و سفال و سرامیک برای دیدن، شناختن و همراه کردن هنر در زندگی روزمره.",
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

const baseNavLinks = [
  { href: "/#collections", label: "دسته‌بندی‌ها" },
  { href: "/#featured", label: "منتخب‌ها" },
  { href: "/#story", label: "داستان" },
  { href: "/#artists", label: "هنرمندان" },
  { href: "/#trust", label: "اطلاعات خرید" },
  { href: "/#contact", label: "تماس" },
] as const;

/** "My orders" exists only where the store has an order system to read them from. */
export const navLinks: ReadonlyArray<{ readonly href: string; readonly label: string }> = ORDER_API_BASE ? [...baseNavLinks, { href: "/orders", label: "سفارش‌های من" }] : baseNavLinks;

/**
 * REAL business information. Only the brand name, slogan and Instagram account
 * are confirmed. Everything else is unknown and must stay `null` (the UI then
 * shows a clearly marked placeholder) until the gallery supplies it.
 */
export const site = {
  name: "جریان ما",
  slogan: "اینجا هنر در جریان است",
  description:
    "گالری و فروشگاه آثار هنری دست‌ساز ایرانی؛ دیوارکوب‌های بافته، ماکرومه و دکور خانه برای دیدن، شناختن و همراه کردن هنر در زندگی روزمره.",
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

export const navLinks = [
  { href: "#collections", label: "مجموعه‌ها" },
  { href: "#featured", label: "آثار منتخب" },
  { href: "#story", label: "داستان ما" },
  { href: "#trust", label: "اطمینان" },
  { href: "#contact", label: "تماس" },
] as const;

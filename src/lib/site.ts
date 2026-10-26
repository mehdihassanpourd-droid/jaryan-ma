export const site = {
  name: "جریان ما",
  slogan: "اینجا هنر در جریان است",
  description:
    "گالری و فروشگاه آثار هنری دست‌ساز ایرانی؛ جایی برای دیدن، شناختن و همراه کردن هنر در زندگی روزمره.",
  instagramHandle: "jaryan.ma",
  instagramUrl: "https://instagram.com/jaryan.ma",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;

export const navLinks = [
  { href: "#collections", label: "دسته‌بندی‌ها" },
  { href: "#featured", label: "آثار منتخب" },
  { href: "#spotlight", label: "نگاه نزدیک" },
  { href: "#story", label: "درباره ما" },
] as const;

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { Icon, type IconName } from "@/components/ui/Icons";
import { cartCount } from "@/lib/cart";
import { formatNumber } from "@/lib/format";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { ORDER_API_BASE } from "@/lib/order-config";
import { site } from "@/lib/site";
import { useCart } from "@/components/shop/useCart";

interface Tab {
  key: string;
  label: string;
  href: string;
  icon: IconName | "instagram";
  external?: boolean;
}

/** The items follow what this build can really do: the cart only with a live catalogue, "my orders" only with an order system. */
const tabs: Tab[] = [
  { key: "home", label: "خانه", href: "/", icon: "home" },
  { key: "categories", label: "دسته‌ها", href: "/#collections", icon: "grid" },
  ...(LIVE_CATALOG_BASE
    ? [{ key: "cart", label: "سبد خرید", href: "/cart", icon: "bag" as const }]
    : [{ key: "featured", label: "منتخب‌ها", href: "/#featured", icon: "frame" as const }]),
  ...(ORDER_API_BASE ? [{ key: "orders", label: "سفارش‌ها", href: "/orders", icon: "receipt" as const }] : []),
  { key: "instagram", label: "اینستاگرام", href: site.instagramUrl, icon: "instagram", external: true },
];

/** Bottom navigation for phones (hidden from `md`). Fixed, so pages reserve space for it (see the body padding in the layout). */
export function TabBar() {
  const pathname = usePathname();
  const { lines, hydrated } = useCart();
  const count = hydrated ? cartCount(lines) : 0;
  const current = (tab: Tab) => (tab.key === "home" ? pathname === "/" : tab.key === "cart" ? pathname.startsWith("/cart") || pathname.startsWith("/checkout") : tab.key === "orders" ? pathname.startsWith("/order") : false);

  return (
    <nav aria-label="پیمایش سریع" className="fixed inset-x-0 bottom-0 z-40 border-t-2 border-bark-900 bg-ivory-50 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <ul className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const active = current(tab);
          const content = (
            <>
              <span className={`relative flex h-8 w-14 items-center justify-center transition-colors ${active ? "bg-bark-900 text-ivory-50" : "text-bark-700"}`}>
                {tab.icon === "instagram" ? <InstagramIcon className="h-6 w-6" /> : <Icon name={tab.icon} className="h-6 w-6" />}
                {tab.key === "cart" && count > 0 && (
                  <span data-testid="tab-cart-count" aria-hidden="true" className="absolute -end-0.5 -top-1 flex h-5 min-w-5 items-center justify-center bg-clay-600 px-1 text-[11px] font-bold text-ivory-50">
                    {formatNumber(count)}
                  </span>
                )}
              </span>
              <span className={`text-[11px] leading-4 ${active ? "font-bold text-bark-900" : "text-bark-700"}`}>{tab.label}</span>
            </>
          );
          const cls = "flex min-h-16 flex-col items-center justify-center gap-0.5 py-1.5";
          return (
            <li key={tab.key}>
              {tab.external ? (
                <a href={tab.href} target="_blank" rel="noopener noreferrer" className={cls}>
                  {content}
                </a>
              ) : (
                <Link href={tab.href} aria-current={active ? "page" : undefined} className={cls}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

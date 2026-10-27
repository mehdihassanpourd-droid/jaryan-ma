"use client";

import Link from "next/link";
import { cartCount } from "@/lib/cart";
import { formatNumber } from "@/lib/format";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { useCart } from "./useCart";

/** Header cart button with the number of items. Only exists when the store has a live catalogue (otherwise there is nothing to buy). */
export function CartLink() {
  const { lines, hydrated } = useCart();
  if (!LIVE_CATALOG_BASE) return null;
  const count = hydrated ? cartCount(lines) : 0;
  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `سبد خرید، ${formatNumber(count)} کالا` : "سبد خرید"}
      className="relative flex h-11 w-11 items-center justify-center rounded-full text-bark-700 hover:bg-sand-100"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 8h14l-1.2 11H6.2L5 8z" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      </svg>
      {count > 0 && (
        <span data-testid="cart-count" aria-hidden="true" className="absolute -end-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-olive-700 px-1 text-[11px] font-bold text-ivory-50">
          {formatNumber(count)}
        </span>
      )}
    </Link>
  );
}

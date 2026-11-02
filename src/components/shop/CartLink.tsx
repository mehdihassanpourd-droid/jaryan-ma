"use client";

import Link from "next/link";
import { cartCount } from "@/lib/cart";
import { formatNumber } from "@/lib/format";
import { useCart } from "./useCart";

/** Header cart button with the number of items. Always visible; in a build without a live catalogue the cart page says plainly that buying is not active yet. */
export function CartLink() {
  const { lines, hydrated } = useCart();
  const count = hydrated ? cartCount(lines) : 0;
  return (
    <Link
      href="/cart"
      aria-label={count > 0 ? `سبد خرید، ${formatNumber(count)} کالا` : "سبد خرید"}
      className="relative flex h-12 w-12 items-center justify-center text-ivory-50 hover:bg-ivory-50/15"
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 8h14l-1.2 11H6.2L5 8z" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      </svg>
      {count > 0 && (
        <span data-testid="cart-count" aria-hidden="true" className="absolute -end-0.5 -top-0.5 flex h-6 min-w-6 items-center justify-center bg-ivory-50 px-1 text-xs font-black text-burgundy-600">
          {formatNumber(count)}
        </span>
      )}
    </Link>
  );
}

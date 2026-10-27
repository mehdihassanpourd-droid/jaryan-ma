import type { Metadata } from "next";
import { CartView } from "@/components/shop/CartView";

// The cart is personal and built in the browser: nothing for search engines.
export const metadata: Metadata = { title: "سبد خرید", robots: { index: false, follow: false } };

export default function CartPage() {
  return <CartView />;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderPageView } from "@/components/shop/OrderViews";

// A customer's own order, read in the browser after sign-in: never indexable.
export const metadata: Metadata = { title: "سفارش", robots: { index: false, follow: false } };

export default function OrderPage() {
  return (
    <Suspense fallback={null}>
      <OrderPageView />
    </Suspense>
  );
}

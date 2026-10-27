import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutView } from "@/components/shop/CheckoutView";

export const metadata: Metadata = { title: "تکمیل سفارش", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutView />
    </Suspense>
  );
}

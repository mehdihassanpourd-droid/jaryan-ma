import type { Metadata } from "next";
import { OrdersPageView } from "@/components/shop/OrderViews";

export const metadata: Metadata = { title: "سفارش‌های من", robots: { index: false, follow: false } };

export default function OrdersPage() {
  return <OrdersPageView />;
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { LiveProductView } from "@/components/live/LiveProductView";

// The live product page: one static page that reads `?slug=` in the browser, so a product published after the last
// deployment still has a page. Its content is loaded at view time, so it is not indexable; search engines use /products/<slug>.
export const metadata: Metadata = { title: "محصول", robots: { index: false, follow: true } };

export default function LiveProductPage() {
  return (
    <Suspense fallback={null}>
      <LiveProductView />
    </Suspense>
  );
}

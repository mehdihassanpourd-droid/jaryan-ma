import type { Metadata, Viewport } from "next";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { MobileCtaBar } from "@/components/layout/MobileCtaBar";
import { site } from "@/lib/site";
import { seoSettings } from "@/seo/config";
import "./globals.css";

const { origin, indexing } = seoSettings();

export const metadata: Metadata = {
  metadataBase: new URL(origin ?? site.url),
  // Closed until the owner launches the site (SEO_ALLOW_INDEXING=true); sample pages override this per page.
  robots: indexing ? { index: true, follow: true } : { index: false, follow: false },
  title: { default: `${site.name} | ${site.slogan}`, template: `%s | ${site.name}` },
  description: site.description,
  openGraph: { title: site.name, description: site.slogan, locale: "fa_IR", type: "website" },
};

export const viewport: Viewport = {
  themeColor: "#fdfbf6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-bark-900 focus:px-5 focus:py-2 focus:text-ivory-50"
        >
          پرش به محتوای اصلی
        </a>
        <DemoBanner />
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <MobileCtaBar />
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { DemoBanner } from "@/components/layout/DemoBanner";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { site } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
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
        <DemoBanner />
        <Header />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}

import { BrandStory } from "@/components/home/BrandStory";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { ContactSection } from "@/components/home/ContactSection";
import { FeaturedProducts } from "@/components/home/FeaturedProducts";
import { Hero } from "@/components/home/Hero";
import { Spotlight } from "@/components/home/Spotlight";
import { TrustSection } from "@/components/home/TrustSection";
import type { Metadata } from "next";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { site } from "@/lib/site";
import { loadSeo } from "@/seo";
import { JsonLd } from "@/seo/JsonLd";
import { siteJsonLd } from "@/seo/jsonld";

export async function generateMetadata(): Promise<Metadata> {
  const { origin } = (await loadSeo()).seo.settings;
  return origin ? { alternates: { canonical: `${origin}/` } } : {};
}

export default async function HomePage() {
  const { origin } = (await loadSeo()).seo.settings;
  return (
    <>
      <JsonLd data={siteJsonLd(origin, site.name, site.instagramUrl)} />
      <Hero />
      {/* The sample collections and spotlight give way to the real catalogue once one is connected. */}
      {!LIVE_CATALOG_BASE && <CategoryGrid />}
      <FeaturedProducts />
      {!LIVE_CATALOG_BASE && <Spotlight />}
      <BrandStory />
      <TrustSection />
      <ContactSection />
    </>
  );
}

import { ArtistsBand } from "@/components/home/ArtistsBand";
import { CatalogLinks } from "@/components/home/CatalogLinks";
import { CategoryShowcase } from "@/components/home/CategoryShowcase";
import { ContactSection } from "@/components/home/ContactSection";
import { FeaturedProducts } from "@/components/home/FeaturedProducts";
import { FeelBand } from "@/components/home/FeelBand";
import { Hero } from "@/components/home/Hero";
import { InfoNotes } from "@/components/home/InfoNotes";
import { StoryBand } from "@/components/home/StoryBand";
import { LiveShop } from "@/components/live/LiveShop";
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
      {/* The sample categories and products give way to the real catalogue (read live in the browser) once one is connected. */}
      {LIVE_CATALOG_BASE ? (
        <LiveShop />
      ) : (
        <>
          <CategoryShowcase />
          <FeaturedProducts />
        </>
      )}
      <StoryBand />
      <ArtistsBand />
      <FeelBand />
      <CatalogLinks />
      <InfoNotes />
      <ContactSection />
    </>
  );
}

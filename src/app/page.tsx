import { BrandStory } from "@/components/home/BrandStory";
import { CategoryGrid } from "@/components/home/CategoryGrid";
import { FeaturedProducts } from "@/components/home/FeaturedProducts";
import { Hero } from "@/components/home/Hero";
import { InstagramCta } from "@/components/home/InstagramCta";
import { Spotlight } from "@/components/home/Spotlight";

export default function HomePage() {
  return (
    <>
      <Hero />
      <CategoryGrid />
      <FeaturedProducts />
      <Spotlight />
      <BrandStory />
      <InstagramCta />
    </>
  );
}

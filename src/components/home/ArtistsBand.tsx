import { SampleImage } from "@/components/product/SampleImage";
import { Container } from "@/components/ui/Container";
import { LeafBranch, WaveTop } from "@/components/ui/Ornaments";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import type { ArtistProfile, SampleArt } from "@/types/catalog";

const PLACEHOLDER_ART: SampleArt[] = ["artist-1", "artist-2", "artist-3"];

/**
 * Curated artists (a future feature, not a marketplace). With no profiles it shows three clearly labelled abstract placeholders
 * (no names, no faces); once the gallery has curated profiles they are passed in and listed instead.
 */
export function ArtistsBand({ artists = [] }: { artists?: ArtistProfile[] }) {
  const real = artists.length > 0;
  return (
    <section id="artists" aria-labelledby="artists-title" className="relative mt-16 scroll-mt-20 overflow-hidden bg-teal-100 pb-14 pt-16 sm:mt-24 sm:pb-20 sm:pt-24">
      <WaveTop />
      <Container className="relative">
        <div className="grid grid-cols-[1.15fr_0.85fr] items-center gap-4 sm:gap-10">
          <div>
            <h2 id="artists-title" className="text-balance text-[1.9rem] font-black leading-snug text-bark-900 sm:text-5xl">
              از هنرمندان، برای زندگی امروز
            </h2>
            <p className="mt-3 max-w-lg text-[0.95rem] leading-8 text-bark-700 sm:text-base sm:leading-9">هر اثر در جریان ما با دقت انتخاب شده تا بخشی از داستان زندگی شما باشد.</p>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-6 text-bark-700 sm:text-sm">
              <PlaceholderTag label={real ? "هنرمندان منتخب" : "به‌زودی"} />
              {real ? "هنرمندان را گالری انتخاب می‌کند." : "گالری هنرمندان را انتخاب می‌کند؛ بازارچهٔ باز نیست. متن نمونه و نیازمند تأیید."}
            </p>
          </div>
          <div className="relative">
            <LeafBranch className="absolute -end-4 -top-9 z-10 h-24 w-20 rotate-6 text-teal-500 sm:h-32 sm:w-24" />
            <div className="blob-d relative aspect-[4/5] overflow-hidden ring-4 ring-ivory-50">
              <SampleImage art="studio-2" alt="تصویر موقت: کارگاه سفالگری با یک کاسهٔ گلی روی چرخ" />
            </div>
            <div className="absolute bottom-3 start-2">
              <PlaceholderTag label="تصویر موقت" />
            </div>
          </div>
        </div>
        <ul className="mt-9 grid max-w-xl grid-cols-3 gap-3 sm:gap-6">
          {real
            ? artists.map((a, i) => (
                <li key={a.slug}>
                  <div className="blob-c aspect-square overflow-hidden bg-sand-100 ring-1 ring-sand-200">
                    {a.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
                      <img src={a.imageUrl} alt={a.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <SampleImage art={PLACEHOLDER_ART[i % 3]!} alt={`تصویر موقت: نمایهٔ ${a.name}`} />
                    )}
                  </div>
                  <p className="mt-2 text-center text-sm font-bold text-bark-900">{a.name}</p>
                </li>
              ))
            : PLACEHOLDER_ART.map((art, i) => (
                <li key={art}>
                  <div className="blob-c aspect-square overflow-hidden bg-sand-100 ring-1 ring-sand-300">
                    <SampleImage art={art} alt={`تصویر موقت: نمایهٔ هنرمند منتخب نمونه ${["۱", "۲", "۳"][i]}`} />
                  </div>
                  <p className="mt-2 text-center text-xs leading-6 text-bark-700">
                    هنرمند منتخب {["۱", "۲", "۳"][i]}
                    <br />
                    <span className="text-bark-600">نمونه</span>
                  </p>
                </li>
              ))}
        </ul>
      </Container>
    </section>
  );
}

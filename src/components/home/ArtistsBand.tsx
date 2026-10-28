import { SampleImage } from "@/components/product/SampleImage";
import { Container } from "@/components/ui/Container";
import { PlaceholderTag } from "@/components/ui/PlaceholderTag";
import type { ArtistProfile, SampleArt } from "@/types/catalog";

const PLACEHOLDER_ART: SampleArt[] = ["artist-1", "artist-2", "artist-3"];
/** Each portrait hangs at a different height. */
const STAGGER = ["", "mt-10 sm:mt-16", "mt-5 sm:mt-8"] as const;

/**
 * Curated artists (a future feature, not a marketplace). With no profiles it shows three clearly labelled abstract placeholders
 * (no names, no faces); once the gallery has curated profiles they are passed in and listed instead.
 */
export function ArtistsBand({ artists = [] }: { artists?: ArtistProfile[] }) {
  const real = artists.length > 0;
  return (
    <section id="artists" aria-labelledby="artists-title" className="mt-24 scroll-mt-20 bg-bark-900 pb-20 pt-4 text-ivory-50 sm:mt-40 sm:pb-32">
      <Container>
        <div className="border-t-4 border-ivory-50 pt-3">
          <p aria-hidden="true" className="text-sm font-black text-ivory-50">۰۴</p>
          <div className="mt-1 grid gap-6 sm:grid-cols-12 sm:gap-8">
            <h2 id="artists-title" className="text-balance text-5xl font-black leading-[1.15] sm:col-span-7 sm:text-7xl">
              از هنرمندان، <br />
              برای زندگی امروز
            </h2>
            <div className="sm:col-span-4 sm:col-start-9 sm:self-end">
              <p className="text-lg leading-9 text-ivory-100">هر اثر در جریان ما با دقت انتخاب شده تا بخشی از داستان زندگی شما باشد.</p>
              <p className="mt-3 flex flex-wrap items-center gap-2 text-sm leading-6 text-ivory-100">
                <PlaceholderTag label={real ? "هنرمندان منتخب" : "به‌زودی"} />
                {real ? "هنرمندان را گالری انتخاب می‌کند." : "گالری هنرمندان را انتخاب می‌کند؛ بازارچهٔ باز نیست. متن نمونه و نیازمند تأیید."}
              </p>
            </div>
          </div>
        </div>
        <ul className="mt-14 grid grid-cols-3 items-start gap-3 sm:gap-8">
          {real
            ? artists.map((a, i) => (
                <li key={a.slug} className={STAGGER[i % 3]}>
                  <div className="aspect-[3/4] overflow-hidden bg-teal-700">
                    {a.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- static export: no image optimiser
                      <img src={a.imageUrl} alt={a.name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                    ) : (
                      <SampleImage art={PLACEHOLDER_ART[i % 3]!} alt={`تصویر موقت: نمایهٔ ${a.name}`} />
                    )}
                  </div>
                  <p className="mt-3 border-t-2 border-ivory-50 pt-2 text-sm font-black">{a.name}</p>
                </li>
              ))
            : PLACEHOLDER_ART.map((art, i) => (
                <li key={art} className={STAGGER[i]}>
                  <div className="aspect-[3/4] overflow-hidden bg-teal-700">
                    <SampleImage art={art} alt={`تصویر موقت: نمایهٔ هنرمند منتخب نمونه ${["۱", "۲", "۳"][i]}`} />
                  </div>
                  <p className="mt-3 border-t-2 border-ivory-50 pt-2 text-xs font-bold leading-6">
                    هنرمند منتخب {["۱", "۲", "۳"][i]}
                    <br />
                    <span className="font-medium text-ivory-100">نمونه</span>
                  </p>
                </li>
              ))}
        </ul>
      </Container>
    </section>
  );
}

import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { CartLink } from "@/components/shop/CartLink";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";
import { navLinks, site } from "@/lib/site";
import { MobileNav } from "./MobileNav";
import { Wordmark } from "./Wordmark";

/**
 * Phone layout follows the approved reference: the cart (or, while nothing can be bought yet, the Instagram account) on one side,
 * the hand-lettered wordmark in the middle, the menu on the other side. From `md` up the wordmark, the links and the actions line up in a row.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b-2 border-bark-900 bg-ivory-50">
      <Container className="relative flex h-16 items-center justify-between gap-4 md:h-20 md:gap-4 lg:gap-8">
        <Link href="/" aria-label={`${site.name}، صفحهٔ اصلی`} className="order-2 text-bark-900 md:order-1">
          <Wordmark className="text-2xl md:text-3xl" />
        </Link>
        <nav aria-label="منوی اصلی" className="order-2 hidden md:block">
          <ul className="flex items-center gap-4 text-sm lg:gap-7 font-bold text-bark-700">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="py-2 transition-colors hover:text-bark-900">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="order-1 flex min-w-11 items-center justify-start gap-2 md:order-3">
          <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" variant="secondary" className="max-md:hidden">
            <InstagramIcon className="h-4 w-4" />
            <span dir="ltr">@{site.instagramHandle}</span>
          </ButtonLink>
          {LIVE_CATALOG_BASE ? (
            <CartLink />
          ) : (
            <a
              href={site.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="اینستاگرام جریان ما"
              className="flex h-11 w-11 items-center justify-center text-bark-900 hover:bg-sand-100 md:hidden"
            >
              <InstagramIcon className="h-6 w-6" />
            </a>
          )}
        </div>
        <div className="order-3 flex min-w-11 justify-end md:hidden">
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}

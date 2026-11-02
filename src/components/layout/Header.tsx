import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { CartLink } from "@/components/shop/CartLink";
import { navLinks, site } from "@/lib/site";
import { MobileNav } from "./MobileNav";
import { Logo } from "./Logo";
import { LogoLink } from "./LogoLink";

/**
 * Phone layout follows the approved reference: the cart (or, while nothing can be bought yet, the Instagram account) on one side,
 * the hand-lettered wordmark in the middle, the menu on the other side. From `md` up the wordmark, the links and the actions line up in a row.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-ivory-50/25 bg-burgundy-600 text-ivory-50">
      <Container className="relative flex h-[4.75rem] items-center justify-between gap-4 md:h-24 md:gap-4 lg:gap-8">
        <LogoLink className="order-2 px-2 md:order-1 md:px-0">
          {/* the mark is tall and narrow (39px wide on a phone): the side padding makes the tap area 55px without changing the logo */}
          <Logo height={80} eager className="h-14 w-auto md:h-[4.5rem]" />
        </LogoLink>
        <nav aria-label="منوی اصلی" className="order-2 hidden md:block">
          <ul className="flex items-center gap-4 text-sm lg:gap-7 font-bold text-ivory-100">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="py-2 transition-colors hover:text-ivory-50 hover:underline hover:underline-offset-8">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="order-1 flex min-w-12 items-center justify-start gap-2 md:order-3">
          <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" variant="onDark" className="max-md:hidden">
            <InstagramIcon className="h-4 w-4" />
            <span dir="ltr">@{site.instagramHandle}</span>
          </ButtonLink>
          <CartLink />
        </div>
        <div className="order-3 flex min-w-12 justify-end md:hidden">
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}

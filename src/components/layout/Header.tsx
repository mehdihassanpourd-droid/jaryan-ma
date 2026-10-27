import Link from "next/link";
import { ButtonLink } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { CartLink } from "@/components/shop/CartLink";
import { navLinks, site } from "@/lib/site";
import { MobileNav } from "./MobileNav";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-sand-200/70 bg-ivory-50/90 backdrop-blur">
      <Container className="relative flex h-16 items-center justify-between gap-6 md:h-20">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-xl font-extrabold text-bark-900 md:text-2xl">{site.name}</span>
          <span className="hidden text-xs text-bark-600 lg:inline">{site.slogan}</span>
        </Link>
        <nav aria-label="منوی اصلی" className="hidden md:block">
          <ul className="flex items-center gap-8 text-sm text-bark-600">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="py-2 transition-colors hover:text-bark-900">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex items-center gap-2">
          <ButtonLink
            href={site.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="secondary"
            className="max-md:hidden"
          >
            <InstagramIcon className="h-4 w-4" />
            <span dir="ltr">@{site.instagramHandle}</span>
          </ButtonLink>
          <CartLink />
          <MobileNav />
        </div>
      </Container>
    </header>
  );
}

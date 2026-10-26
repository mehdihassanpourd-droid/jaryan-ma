import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { navLinks, site } from "@/lib/site";
import { MobileNav } from "./MobileNav";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-sand-200/70 bg-ivory-50/90 backdrop-blur">
      <Container className="relative flex h-16 items-center justify-between">
        <Link href="/" className="text-xl font-extrabold tracking-tight text-bark-900">
          {site.name}
        </Link>
        <nav aria-label="منوی اصلی" className="hidden md:block">
          <ul className="flex items-center gap-8 text-sm text-bark-600">
            {navLinks.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="transition-colors hover:text-bark-900">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <MobileNav />
      </Container>
    </header>
  );
}

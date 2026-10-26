import { Container } from "@/components/ui/Container";
import { site } from "@/lib/site";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-sand-200 bg-ivory-100 py-12">
      <Container className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-lg font-bold text-bark-900">{site.name}</p>
          <p className="mt-1 text-sm text-bark-600">{site.slogan}</p>
        </div>
        <div className="text-sm text-bark-600">
          <a
            href={site.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-bark-900"
            dir="ltr"
          >
            @{site.instagramHandle}
          </a>
          <p className="mt-1 text-xs text-bark-500">© {site.name} — همه حقوق محفوظ است.</p>
        </div>
      </Container>
    </footer>
  );
}

import { ButtonLink } from "@/components/ui/Button";
import { InstagramIcon } from "@/components/ui/InstagramIcon";
import { site } from "@/lib/site";

/** Persistent call-to-action on phones: the Instagram account is the real contact channel today. */
export function MobileCtaBar() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-ivory-50/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
      <ButtonLink href={site.instagramUrl} target="_blank" rel="noopener noreferrer" size="lg" className="w-full">
        <InstagramIcon />
        <span>مشاهده آثار در اینستاگرام</span>
      </ButtonLink>
    </div>
  );
}

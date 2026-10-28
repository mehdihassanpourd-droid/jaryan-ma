import type { ReactNode } from "react";

/**
 * The large product picture: a 4:5 frame with one generous organic corner (never a plain rounded card), on a soft tinted shape.
 * Real photographs are never cropped by more than the frame's aspect ratio, so the product stays whole.
 */
export function GalleryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden="true" className="absolute -inset-x-2 -bottom-3 top-6 -z-10 rounded-[3rem] bg-teal-100" />
      <div className="relative aspect-[4/5] overflow-hidden bg-sand-100 ring-1 ring-sand-200 [border-radius:2.25rem_1.25rem_5rem_1.25rem]">{children}</div>
    </div>
  );
}

/** A thumbnail slot (square, soft corners). */
export const thumbClass = "block aspect-square w-full overflow-hidden rounded-2xl ring-2 transition";

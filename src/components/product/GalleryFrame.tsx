import type { ReactNode } from "react";

/**
 * The large product picture: a straight-edged 4:5 frame, the centrepiece of the page, on a vermilion block offset behind it.
 * Real photographs are never cropped by more than the frame's aspect ratio, so the product stays whole.
 */
export function GalleryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate">
      <div aria-hidden="true" className="absolute -bottom-4 -end-4 top-14 -z-10 w-full bg-clay-600 sm:-end-6" />
      <div className="relative aspect-[4/5] overflow-hidden bg-sand-100">{children}</div>
    </div>
  );
}

/** A thumbnail slot (square, straight edges). */
export const thumbClass = "block aspect-square w-full overflow-hidden ring-2 transition";

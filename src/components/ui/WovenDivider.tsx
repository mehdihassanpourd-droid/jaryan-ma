import { useId } from "react";

/** Decorative woven band used between sections. */
export function WovenDivider({ className = "" }: { className?: string }) {
  const id = `divider${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg aria-hidden="true" width="100%" height="14" className={`block text-sand-300 ${className}`}>
      <defs>
        <pattern id={id} width="28" height="14" patternUnits="userSpaceOnUse">
          <path d="M0 7 L7 0 L14 7 L7 14Z M14 7 L21 0 L28 7 L21 14Z" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </pattern>
      </defs>
      <rect width="100%" height="14" fill={`url(#${id})`} />
    </svg>
  );
}

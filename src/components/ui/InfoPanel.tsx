import type { ReactNode } from "react";

/** Solid card for REAL business information (contrast with `PlaceholderPanel`). */
export function InfoPanel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={` bg-ivory-50 p-6 shadow-soft ring-1 ring-sand-200 ${className}`}>
      <h3 className="mb-3 font-bold text-bark-900">{title}</h3>
      <div className="text-sm leading-7 text-bark-600">{children}</div>
    </div>
  );
}

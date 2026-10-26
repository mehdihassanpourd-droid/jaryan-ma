import type { ReactNode } from "react";
import { PlaceholderTag } from "./PlaceholderTag";

interface PlaceholderPanelProps {
  title: string;
  children: ReactNode;
  tagLabel?: string;
  className?: string;
}

/** Dashed card that visibly says "this is sample content". */
export function PlaceholderPanel({ title, children, tagLabel, className = "" }: PlaceholderPanelProps) {
  return (
    <div className={`rounded-2xl border border-dashed border-sand-400 bg-ivory-50/70 p-6 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-bold text-bark-900">{title}</h3>
        <PlaceholderTag label={tagLabel} />
      </div>
      <div className="text-sm leading-7 text-bark-600">{children}</div>
    </div>
  );
}

import type { ReactNode } from "react";

type Tone = "neutral" | "olive" | "demo";

const tones: Record<Tone, string> = {
  neutral: "bg-sand-100 text-bark-700",
  olive: "bg-olive-100 text-olive-700",
  demo: "bg-ivory-50/90 text-bark-600 ring-1 ring-sand-300",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-block px-3 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

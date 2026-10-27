"use client";

import { useEffect, useMemo, useState } from "react";
import { createLiveCatalog } from "@/lib/live-catalog";
import { LIVE_CATALOG_BASE } from "@/lib/live-config";

/** The live catalogue client, or null when this build has none. */
export function useLiveCatalog() {
  return useMemo(() => (LIVE_CATALOG_BASE ? createLiveCatalog(LIVE_CATALOG_BASE) : null), []);
}

export type Load<T> = { state: "loading" } | { state: "error" } | { state: "ready"; value: T };

/** Runs a loader once per `key` and reports loading / error / ready. */
export function useLoad<T>(load: (() => Promise<T>) | null, key: string): Load<T> {
  const [result, setResult] = useState<{ key: string; load: Load<T> } | null>(null);
  useEffect(() => {
    if (!load) return;
    let live = true;
    load().then(
      (value) => live && setResult({ key, load: { state: "ready", value } }),
      () => live && setResult({ key, load: { state: "error" } }),
    );
    return () => {
      live = false;
    };
    // `load` is rebuilt every render by callers; `key` identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return result && result.key === key ? result.load : { state: "loading" };
}

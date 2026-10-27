"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MethodQuote } from "@/domain/shipping/pricing";
import { OrderApiError, type OrderApi } from "@/lib/order-api";

export type QuoteState =
  | { status: "idle" }
  | { status: "loading"; quotes: MethodQuote[] | null }
  | { status: "ready"; quotes: MethodQuote[]; weightGrams: number }
  | { status: "error"; quotes: MethodQuote[] | null };

interface Line {
  slug: string;
  sku: string | null;
  quantity: number;
}

/**
 * Asks the SERVER what delivery costs for this cart and place (the browser never computes a fee). Re-asks when the
 * cart or the province/city change, ignores answers that arrive late, and can be told the current prices after the
 * server refused an order because they had changed.
 */
export function useShippingQuote(api: OrderApi | null, enabled: boolean, lines: Line[], destination: { province: string; city: string } | null) {
  const [state, setState] = useState<QuoteState>({ status: "idle" });
  const sequence = useRef(0);
  const key = JSON.stringify([lines, destination]);

  const load = useCallback(() => {
    if (!api || !enabled || lines.length === 0) return;
    const mine = ++sequence.current;
    setState((s) => ({ status: "loading", quotes: s.status === "idle" ? null : s.quotes }));
    api.quoteShipping(lines, destination).then(
      (r) => {
        if (mine === sequence.current) setState({ status: "ready", quotes: r.quotes, weightGrams: r.weightGrams });
      },
      (error: unknown) => {
        if (mine !== sequence.current) return;
        // A cart the server cannot price (a line sold out meanwhile) is reported by the checkout itself; keep the last prices.
        setState((s) => ({ status: "error", quotes: error instanceof OrderApiError || s.status === "idle" ? null : s.quotes }));
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for lines + destination
  }, [api, enabled, key]);

  useEffect(() => {
    if (!enabled) return;
    // The city is typed: wait for a pause before asking.
    const timer = setTimeout(load, destination ? 350 : 0);
    return () => clearTimeout(timer);
  }, [enabled, load, destination]);

  const replace = useCallback((quotes: MethodQuote[]) => {
    sequence.current++;
    setState((s) => ({ status: "ready", quotes, weightGrams: s.status === "ready" ? s.weightGrams : 0 }));
  }, []);

  return { state, reload: load, replace };
}

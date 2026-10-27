import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

const POLL_MS = 30_000;

/**
 * How many orders are waiting for a decision, for the "new orders" indicator. It asks the admin's own server (same origin:
 * no push service, nothing foreign, so it keeps working when the international internet is cut) every 30 s while the page
 * is visible and once when the person comes back to it. A failed request just keeps the last number.
 */
export function useOrderSummary(enabled: boolean): { pending: number; known: boolean; refresh: () => void } {
  const [state, setState] = useState<{ pending: number; known: boolean }>({ pending: 0, known: false });
  const [tick, setTick] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      api<{ pending: number }>("GET", "/orders/summary").then(
        (r) => alive.current && setState({ pending: r.pending, known: true }),
        () => undefined,
      );
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled, tick]);

  return { ...state, refresh: () => setTick((t) => t + 1) };
}

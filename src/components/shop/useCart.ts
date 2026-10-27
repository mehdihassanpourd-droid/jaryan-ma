"use client";

import { useCallback, useSyncExternalStore } from "react";
import { addLine, CART_STORAGE_KEY, parseCart, removeLine, serializeCart, setLineQuantity, type CartLine } from "@/lib/cart";

const CHANGE_EVENT = "jm-cart-change";
const EMPTY: CartLine[] = [];

/** Where the cart lives if the browser refuses storage (private mode, blocked site data): it then lasts until the tab closes. */
let memory: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(CART_STORAGE_KEY);
  } catch {
    return memory;
  }
}

function writeRaw(raw: string) {
  memory = raw;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, raw);
  } catch {
    /* kept in memory only */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

let cache: { raw: string | null; lines: CartLine[] } = { raw: null, lines: EMPTY };
function snapshot(): CartLine[] {
  const raw = readRaw();
  if (raw !== cache.raw) cache = { raw, lines: parseCart(raw) };
  return cache.lines;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => (e.key === CART_STORAGE_KEY || e.key === null) && onChange();
  window.addEventListener("storage", onStorage); // another tab changed the cart
  window.addEventListener(CHANGE_EVENT, onChange); // this tab did
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const noop = () => () => undefined;

/** False while the page is being prepared on the server / hydrating, so "empty cart" is never flashed for a full one. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/** The cart, kept across reloads and shared between tabs. */
export function useCart() {
  const lines = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const hydrated = useHydrated();
  const update = useCallback((change: (current: readonly CartLine[]) => CartLine[]) => writeRaw(serializeCart(change(snapshot()))), []);
  return {
    lines,
    hydrated,
    add: useCallback((line: CartLine) => update((c) => addLine(c, line)), [update]),
    setQuantity: useCallback((key: string, quantity: number) => update((c) => setLineQuantity(c, key, quantity)), [update]),
    remove: useCallback((key: string) => update((c) => removeLine(c, key)), [update]),
    clear: useCallback(() => update(() => []), [update]),
  };
}

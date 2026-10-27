"use client";

import { useState } from "react";
import type { PublicProduct } from "@/domain/product/snapshot";
import { useLiveCatalog, useLoad, type Load } from "@/components/live/useLiveCatalog";

/**
 * The CURRENT published product behind each cart line (null = no longer published), read from the live catalogue.
 * Prices and availability always come from here, never from what the cart remembers.
 */
export function useCartProducts(slugs: readonly string[]): { products: Load<Map<string, PublicProduct | null>>; retry: () => void } {
  const catalog = useLiveCatalog();
  const [attempt, setAttempt] = useState(0);
  const unique = [...new Set(slugs)].sort();
  const products = useLoad(
    catalog
      ? async () => new Map(await Promise.all(unique.map(async (slug) => [slug, await catalog.loadProduct(slug)] as const)))
      : null,
    `${unique.join(",")}#${attempt}`,
  );
  return { products, retry: () => setAttempt((a) => a + 1) };
}

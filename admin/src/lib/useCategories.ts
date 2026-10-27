import { useCallback, useEffect, useState } from "react";
import type { CategoryRecord } from "@/domain/product/ports";
import { api } from "../api/client";

export function useCategories() {
  const [categories, setCategories] = useState<CategoryRecord[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    api<{ categories: CategoryRecord[] }>("GET", "/categories").then(
      (r) => setCategories(r.categories),
      (e: unknown) => setError(e),
    );
  }, []);
  useEffect(load, [load]);
  return { categories, error, reload: load };
}

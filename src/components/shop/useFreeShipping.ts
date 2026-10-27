"use client";

import { useEffect, useState } from "react";
import type { FreeShippingProgress } from "@/domain/shipping/pricing";
import { fetchFreeShippingPolicy } from "@/lib/order-api";
import { ORDER_API_BASE } from "@/lib/order-config";

/** The shop's free shipping policy, read once from our own server (null: no order system, or it could not be read: then nothing is promised). */
export function useFreeShippingPolicy(): FreeShippingProgress | null {
  const [policy, setPolicy] = useState<FreeShippingProgress | null>(null);
  useEffect(() => {
    if (!ORDER_API_BASE) return;
    let live = true;
    void fetchFreeShippingPolicy(ORDER_API_BASE).then((p) => live && setPolicy(p));
    return () => {
      live = false;
    };
  }, []);
  return policy;
}

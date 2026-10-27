"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerProfile } from "@/lib/order-api";
import { orderApi } from "./orderClient";

export type CustomerState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; customer: CustomerProfile } | { status: "unreachable" };

/** Who is signed in, according to the server (the session cookie is HttpOnly: the page never sees it). */
export function useCustomer() {
  const [state, setState] = useState<CustomerState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!orderApi) return;
    let live = true;
    orderApi.me().then(
      (customer) => live && setState(customer ? { status: "signedIn", customer } : { status: "signedOut" }),
      () => live && setState({ status: "unreachable" }),
    );
    return () => {
      live = false;
    };
  }, [attempt]);

  return {
    state,
    signedIn: useCallback((customer: CustomerProfile) => setState({ status: "signedIn", customer }), []),
    retry: useCallback(() => {
      setState({ status: "loading" });
      setAttempt((a) => a + 1);
    }, []),
    async signOut() {
      try {
        await orderApi?.logout();
      } finally {
        setState({ status: "signedOut" });
      }
    },
  };
}

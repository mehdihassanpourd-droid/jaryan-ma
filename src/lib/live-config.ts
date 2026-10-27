import { liveCatalogBase } from "@/lib/live-catalog";

/** Inlined at build time: the public base URL of the snapshot store (a public value, never a secret). Null = no live catalogue in this build. */
export const LIVE_CATALOG_BASE = liveCatalogBase(process.env.NEXT_PUBLIC_CATALOG_URL);

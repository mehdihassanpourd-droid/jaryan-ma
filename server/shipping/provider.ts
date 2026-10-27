import type { Destination, MethodQuote } from "../../src/domain/shipping/pricing";
import type { CarrierKey, ShippingMethodKey } from "../../src/domain/shipping/methods";

/** What a provider needs to price a delivery: where, how heavy, how much the goods cost. */
export interface QuoteContext {
  /** null = the customer has not given an address yet (only methods that need none can be priced). */
  destination: Destination | null;
  weightGrams: number;
  subtotalToman: number;
}

/**
 * A source of delivery prices. TODAY the only provider is `ManualRatesProvider` (the owner's own rate table); a later
 * integration with an Iranian postal / courier API is one more class implementing this interface and registered in
 * `createPlatformServices` — checkout, the admin and the storefront do not change. Providers must:
 *  - return a quote for each method they list in `methods` (or `available: false` with a reason);
 *  - never throw for "not served" (that is `available: false`), only for real failures (the method is then unavailable);
 *  - never make the checkout depend on the network at order time unless the owner chose that provider on purpose.
 * Application code depends on this port, never on a carrier's SDK (CLAUDE.md rule 7).
 */
export interface ShippingProvider {
  readonly id: string;
  readonly methods: readonly ShippingMethodKey[];
  quote(context: QuoteContext): Promise<MethodQuote[]>;
  /** A public tracking page for a code, if the carrier has one this provider knows for certain; null otherwise. */
  trackingUrl?(carrier: CarrierKey, code: string): string | null;
}

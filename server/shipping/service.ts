import { SHIPPING_METHODS, type CarrierKey, type ShippingMethodKey } from "../../src/domain/shipping/methods";
import { applyFreeShipping, cartWeightGrams, freeShippingProgress, type Destination, type FreeShippingProgress, type MethodQuote } from "../../src/domain/shipping/pricing";
import { toRules, type ShippingConfigStore } from "./config-store";
import type { ShippingProvider } from "./provider";

export interface ShippingQuote {
  weightGrams: number;
  /** One entry per method, in the fixed display order. */
  quotes: MethodQuote[];
  /** The free shipping policy as it applies to this cart (how much more to buy, or that it qualifies). */
  freeShipping: FreeShippingProgress;
}

/**
 * Asks the registered providers for prices. The first provider that lists a method answers for it; a provider that fails
 * only makes ITS methods unavailable (the order flow never breaks because one carrier integration is down).
 */
export class ShippingService {
  constructor(
    private readonly providers: ShippingProvider[],
    private readonly config: ShippingConfigStore,
    private readonly log: (event: string, detail?: Record<string, unknown>) => void = () => undefined,
  ) {}

  async quote(input: { destination: Destination | null; lines: Array<{ quantity: number; weightGrams: number | null }>; subtotalToman: number }): Promise<ShippingQuote> {
    const { weight, free } = toRules(await this.config.load());
    const weightGrams = cartWeightGrams(input.lines, weight);
    const context = { destination: input.destination, weightGrams, subtotalToman: input.subtotalToman };
    const answers = new Map<ShippingMethodKey, MethodQuote>();
    for (const provider of this.providers) {
      const wanted = provider.methods.filter((m) => !answers.has(m));
      if (wanted.length === 0) continue;
      try {
        for (const q of await provider.quote(context)) if (wanted.includes(q.method) && !answers.has(q.method)) answers.set(q.method, q);
      } catch {
        this.log("shipping.provider_failed", { provider: provider.id });
      }
    }
    // The policy is the shop's, not a provider's: it waives the fee of any qualifying method, whoever priced it.
    const quotes = SHIPPING_METHODS.map((m) => applyFreeShipping(answers.get(m) ?? { method: m, available: false as const, reason: "disabled" as const }, free, input.subtotalToman));
    return { weightGrams, quotes, freeShipping: freeShippingProgress(free, input.subtotalToman) };
  }

  /** The policy alone (for the cart page, before any address or checkout): public information the shopper is promised. */
  async freeShippingPolicy(): Promise<FreeShippingProgress> {
    const { free } = toRules(await this.config.load());
    return freeShippingProgress(free, 0);
  }

  trackingUrl(carrier: CarrierKey, code: string): string | null {
    for (const provider of this.providers) {
      const url = provider.trackingUrl?.(carrier, code);
      if (url) return url;
    }
    return null;
  }
}

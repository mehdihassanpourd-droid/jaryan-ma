import { SHIPPING_METHODS } from "../../src/domain/shipping/methods";
import { quoteAll, type MethodQuote } from "../../src/domain/shipping/pricing";
import { toRules, type ShippingConfigStore } from "./config-store";
import type { QuoteContext, ShippingProvider } from "./provider";

/** Prices from the owner's rate table (admin screen "ارسال و تحویل"). No network, no third party. */
export class ManualRatesProvider implements ShippingProvider {
  readonly id = "manual-rates";
  readonly methods = SHIPPING_METHODS;

  constructor(private readonly config: ShippingConfigStore) {}

  async quote(context: QuoteContext): Promise<MethodQuote[]> {
    const { rules } = toRules(await this.config.load());
    return quoteAll(rules, context.destination, context.weightGrams, context.subtotalToman);
  }
}

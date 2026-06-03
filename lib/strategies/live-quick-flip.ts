import type { Strategy, StrategySignal } from './types';
import type { ResolvedStrategyConfig } from './run-profile';
import { assessFastMovingMarket, isQuickFlipCandidate } from '../markets/fast-moving';

function asResolved(config: Parameters<Strategy['evaluate']>[1]): ResolvedStrategyConfig {
  return config as ResolvedStrategyConfig;
}

/** Highest ask that still allows a full target multiple before the 0.99 cap. */
export function maxQuickFlipEntryPrice(mult = 2.5): number {
  return 0.99 / mult;
}

/**
 * Live quick-flip scalper: $1 in, sell the instant price hits 2.5× (≈$2.50 out).
 * Only enters markets that resolve within 3 hours (exchange endDate required).
 *
 * Entry philosophy: lift the ask on cheap outcomes with room to run, but only
 * where there is a real bid to flip back into and a real (non-zero, non-dead)
 * price — no ask-only books, no 0.1¢ longshots.
 */
export const LiveQuickFlip: Strategy = {
  id: 'live-quick-flip',
  name: 'Live Quick Flip',
  type: 'live-quick-flip',

  evaluate(ctx, rawConfig): StrategySignal | null {
    const config = asResolved(rawConfig);
    const { market, book } = ctx;

    if (config.liveMarketsOnly !== false && !isQuickFlipCandidate(market)) {
      return null;
    }

    if (!book?.asks?.length) return null;

    const ask = book.asks[0].price;
    const askSize = book.asks[0].size;
    if (ask <= 0 || ask >= 1) return null;

    // Floor out dead longshots (e.g. 0.1¢ outcomes that almost always settle to
    // zero and have no real exit). A genuine flip needs a price with room to run
    // AND a real chance of resolving — sub-floor asks are lottery tickets.
    const minEntry = config.minEntryPrice ?? 0;
    if (ask < minEntry) {
      return null;
    }

    const stakeUsd = config.maxSizeUsd ?? 1;
    const mult = config.targetProfitMultiple ?? 2.5;
    const maxEntry = maxQuickFlipEntryPrice(mult);

    if (ask > maxEntry) {
      return null;
    }

    const sharesNeeded = Math.max(1, Math.ceil(stakeUsd / ask));
    const minAskDepth = config.tradingStyle === 'conservative' ? sharesNeeded : 1;
    if (askSize < minAskDepth) {
      return null;
    }

    // A flip needs a way out: require a live bid to sell into. Entering a
    // one-sided (ask-only) book leaves the position with no exit before
    // maxHold, so it can only end in a stop-loss or worthless expiry.
    const bidLevel = book.bids?.[0];
    const bid = bidLevel?.price ?? 0;
    const bidSize = bidLevel?.size ?? 0;
    if (bid <= 0 || bidSize <= 0) {
      return null;
    }

    const mid = book.mid ?? (ask + bid) / 2;
    const spread = book.spread ?? ask - bid;

    const maxSpreadPct =
      config.tradingStyle === 'conservative' ? 8
        : config.tradingStyle === 'balanced' ? 18
          : 30;
    if (mid > 0) {
      const spreadPct = (spread / mid) * 100;
      if (spreadPct > maxSpreadPct) {
        return null;
      }
    }

    const assessment = assessFastMovingMarket(market);
    const targetPrice = Math.min(0.99, ask * mult);
    const targetValue = stakeUsd * mult;

    return {
      action: 'BUY',
      price: ask,
      size: sharesNeeded,
      reason: `Quick flip ${assessment.kind}: $${stakeUsd.toFixed(2)} @ ${ask.toFixed(3)} → target ${targetPrice.toFixed(3)} (${mult}× ≈ $${targetValue.toFixed(2)})`,
      confidence: Math.min(
        0.92,
        0.62 + (maxEntry - ask) / maxEntry * 0.2 + assessment.score / 250,
      ),
      edge: (targetPrice - ask) / ask,
    };
  },
};

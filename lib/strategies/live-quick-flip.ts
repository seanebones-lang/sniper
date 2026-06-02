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
 * Entry philosophy: lift the ask on cheap outcomes with room to run — not wait for
 * bid-side pressure (that filter blocked most real flip setups).
 */
export const LiveQuickFlip: Strategy = {
  id: 'live-quick-flip',
  name: 'Live Quick Flip',
  type: 'live-quick-flip',

  evaluate(ctx, rawConfig): StrategySignal | null {
    const config = asResolved(rawConfig);
    const { market, book, currentPrice } = ctx;

    if (config.liveMarketsOnly !== false && !isQuickFlipCandidate(market)) {
      return null;
    }

    if (!book?.asks?.length) return null;

    const ask = book.asks[0].price;
    const askSize = book.asks[0].size;
    if (ask <= 0 || ask >= 1) return null;

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

    const bid = book.bids?.[0]?.price;
    const mid = book.mid ?? currentPrice ?? ask;
    const spread = book.spread ?? (bid != null ? ask - bid : null);

    const maxSpreadPct =
      config.tradingStyle === 'conservative' ? 8
        : config.tradingStyle === 'balanced' ? 18
          : 30;
    if (spread != null && mid > 0) {
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

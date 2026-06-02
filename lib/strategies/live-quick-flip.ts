import type { Strategy, StrategySignal } from './types';
import type { ResolvedStrategyConfig } from './run-profile';
import { isFastMovingMarket } from '../markets/fast-moving';

function asResolved(config: Parameters<Strategy['evaluate']>[1]): ResolvedStrategyConfig {
  return config as ResolvedStrategyConfig;
}

/**
 * Live quick-flip scalper: $1 in, sell the instant price hits 2.5× (≈$2.50 out).
 * Targets fast-moving live markets — sports in-play, short crypto windows, etc.
 */
export const LiveQuickFlip: Strategy = {
  id: 'live-quick-flip',
  name: 'Live Quick Flip',
  type: 'live-quick-flip',

  evaluate(ctx, rawConfig): StrategySignal | null {
    const config = asResolved(rawConfig);
    const { market, book, currentPrice } = ctx;

    const assessment = isFastMovingMarket(market);
    if (config.liveMarketsOnly !== false && !assessment.fast) {
      return null;
    }

    if (!book?.asks?.length || !book.bids?.length) return null;

    const ask = book.asks[0].price;
    const bid = book.bids[0].price;
    const mid = book.mid ?? currentPrice ?? (ask + bid) / 2;
    if (!mid || ask <= 0) return null;

    const stakeUsd = config.maxSizeUsd ?? 1;
    const mult = config.targetProfitMultiple ?? 2.5;
    const targetPrice = Math.min(0.99, ask * mult);

    // Need meaningful upside before the 0.99 cap (2.5× from 0.40 → 1.0 is valid)
    const maxEntryForFullMultiple = 0.99 / mult;
    if (ask > maxEntryForFullMultiple + 0.02) {
      return null;
    }

    const topBidSize = book.bids[0].size;
    const topAskSize = book.asks[0].size;
    const buyPressure = topBidSize / (topBidSize + topAskSize + 0.0001);

    const minPressure = config.tradingStyle === 'aggressive' ? 0.5 : 0.54;
    if (buyPressure < minPressure) {
      return null;
    }

    const spread = book.spread ?? ask - bid;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 100;
    const maxSpread = config.tradingStyle === 'conservative' ? 4 : 8;
    if (spreadPct > maxSpread) {
      return null;
    }

    const size = Math.max(1, Math.floor(stakeUsd / ask));
    const targetValue = stakeUsd * mult;

    return {
      action: 'BUY',
      price: ask,
      size,
      reason: `Quick flip ${assessment.kind}: $${stakeUsd.toFixed(2)} @ ${ask.toFixed(3)} → target ${targetPrice.toFixed(3)} (${mult}× ≈ $${targetValue.toFixed(2)})`,
      confidence: Math.min(0.92, 0.55 + buyPressure * 0.35 + assessment.score / 200),
      edge: (targetPrice - ask) / ask,
    };
  },
};

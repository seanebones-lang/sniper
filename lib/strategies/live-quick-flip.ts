import type { Strategy, StrategySignal } from './types';
import type { ResolvedStrategyConfig } from './run-profile';
import {
  QUICK_FLIP_MAX_ENTRY_MULTIPLE,
  LIVE_QUICK_FLIP_MIN_ENTRY_PRICE,
  LIVE_QUICK_FLIP_MAX_ENTRY_PRICE,
  LIVE_QUICK_FLIP_MIN_BID_NOTIONAL_RATIO,
  QUICK_FLIP_TAKE_PROFIT_MULTIPLE,
} from './run-profile';
import { assessFastMovingMarket, isQuickFlipCandidate } from '../markets/fast-moving';
import {
  checkLiveEntryGatesSync,
  getRunnerLiveFilterSnapshot,
  defaultLiveFilterSnapshot,
} from '@/lib/monitoring/live-filter-snapshot';

function asResolved(config: Parameters<Strategy['evaluate']>[1]): ResolvedStrategyConfig {
  return config as ResolvedStrategyConfig;
}

/** Highest ask that still allows room to run toward the 2× upper band before the 0.99 cap. */
export function maxQuickFlipEntryPrice(mult = QUICK_FLIP_MAX_ENTRY_MULTIPLE): number {
  return 0.99 / mult;
}

/**
 * Live quick-flip scalper: $1 in, sell at 1.2× (filters from live_intelligence).
 * Only enters markets that resolve within 3 hours (exchange endDate required).
 *
 * Aggressive mode lifts cheap asks when there is real two-sided liquidity.
 * Live micro accounts require bid depth to exit — ask-only lottery entries
 * are rejected even in aggressive mode.
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

    const isLive = config.liveMarketsOnly !== false;

    // Floor out dead longshots (e.g. 0.1¢ outcomes that almost always settle to
    // zero and have no real exit). Live uses a higher floor (2¢ default).
    const minEntry = isLive
      ? Math.max(config.minEntryPrice ?? 0, LIVE_QUICK_FLIP_MIN_ENTRY_PRICE)
      : (config.minEntryPrice ?? 0);
    if (ask < minEntry) {
      return null;
    }

    const stakeUsd = config.maxSizeUsd ?? 1;
    const exitMult = config.targetProfitMultiple ?? QUICK_FLIP_TAKE_PROFIT_MULTIPLE;
    const maxEntry = isLive
      ? Math.min(maxQuickFlipEntryPrice(QUICK_FLIP_MAX_ENTRY_MULTIPLE), LIVE_QUICK_FLIP_MAX_ENTRY_PRICE)
      : maxQuickFlipEntryPrice(QUICK_FLIP_MAX_ENTRY_MULTIPLE);

    if (ask > maxEntry) {
      return null;
    }

    const sharesNeeded = Math.max(1, Math.ceil(stakeUsd / ask));
    const minAskDepth = config.tradingStyle === 'conservative' ? sharesNeeded : 1;
    if (askSize < minAskDepth) {
      return null;
    }

    const bidLevel = book.bids?.[0];
    const bid = bidLevel?.price ?? 0;
    const bidSize = bidLevel?.size ?? 0;
    const hasBid = bid > 0 && bidSize > 0;

    // Live: must be able to sell into the bid — no ask-only lottery tickets.
    if (isLive) {
      if (!hasBid || bidSize < sharesNeeded) {
        return null;
      }
      const bidNotional = bid * bidSize;
      if (bidNotional < stakeUsd * LIVE_QUICK_FLIP_MIN_BID_NOTIONAL_RATIO) {
        return null;
      }
    } else if (config.tradingStyle !== 'aggressive' && !hasBid) {
      return null;
    }

    const snap = isLive ? getRunnerLiveFilterSnapshot() : null;
    const liveFilters = isLive ? (snap ?? defaultLiveFilterSnapshot()) : null;

    if (isLive && snap && checkLiveEntryGatesSync(market, book, ask, bid)) {
      return null;
    }

    if (hasBid) {
      const mid = book.mid ?? (ask + bid) / 2;
      const spread = book.spread ?? ask - bid;
      const maxSpreadPct = isLive
        ? (liveFilters?.maxSpreadPct ?? 25)
        : config.tradingStyle === 'conservative'
          ? 8
          : config.tradingStyle === 'balanced'
            ? 18
            : 50;
      if (mid > 0) {
        const spreadPct = (spread / mid) * 100;
        if (spreadPct > maxSpreadPct) {
          return null;
        }
      }
    }

    const assessment = assessFastMovingMarket(market);
    const minScore = isLive
      ? (liveFilters?.minMarketScore ?? 22)
      : 0;
    if (isLive && assessment.score < minScore) {
      return null;
    }
    const targetPrice = Math.min(0.99, ask * exitMult);
    const targetValue = stakeUsd * exitMult;

    return {
      action: 'BUY',
      price: ask,
      size: sharesNeeded,
      reason: `Quick flip ${assessment.kind}: $${stakeUsd.toFixed(2)} @ ${ask.toFixed(3)} → target ${targetPrice.toFixed(3)} (${exitMult}× ≈ $${targetValue.toFixed(2)})`,
      confidence: Math.min(
        0.92,
        0.62 + (maxEntry - ask) / maxEntry * 0.2 + assessment.score / 250,
      ),
      edge: (targetPrice - ask) / ask,
    };
  },
};

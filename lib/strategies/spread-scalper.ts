import type { Strategy, StrategySignal } from './types';

export const SpreadScalper: Strategy = {
  id: 'spread-scalper',
  name: 'Wide Spread Scalper',
  type: 'spread-scalper',

  evaluate(ctx, config): StrategySignal | null {
    const { book, currentPrice } = ctx;
    if (!book || !book.bids.length || !book.asks.length) return null;

    const spread = book.spread ?? (book.asks[0].price - book.bids[0].price);
    const mid = book.mid ?? currentPrice;
    if (!mid || spread <= 0) return null;

    const spreadPct = (spread / mid) * 100;

    const minSpread = config.minSpreadPct ?? 1.8;

    if (spreadPct >= minSpread) {
      // Snipe the cheaper side (slightly better than mid for taker edge)
      const targetPrice = book.bids[0].price * 0.998; // slight discount to get filled
      const size = Math.min(config.maxSizeUsd / targetPrice, 500); // conservative size

      return {
        action: 'BUY',
        price: targetPrice,
        size: Math.max(10, Math.floor(size)),
        reason: `Wide spread ${spreadPct.toFixed(2)}% (>= ${minSpread}%)`,
        confidence: Math.min(0.9, spreadPct / 5),
      };
    }

    return null;
  },
};

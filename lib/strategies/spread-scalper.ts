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
    const maxSpread = config.maxSpreadPct ?? 35;

    if (spreadPct >= minSpread && spreadPct <= maxSpread) {
      // Live spread-capture crosses at the ask so FOK market BUYs actually fill.
      // Paper / passive mode posts below the bid for simulation realism.
      const takerEntry = config.tradingGoal === 'spread-capture';
      const targetPrice = takerEntry ? book.asks[0].price : book.bids[0].price * 0.998;
      const maxShares = Math.max(1, Math.ceil(config.maxSizeUsd / targetPrice));

      return {
        action: 'BUY',
        price: targetPrice,
        size: maxShares,
        reason: `Wide spread ${spreadPct.toFixed(2)}% (>= ${minSpread}%)`,
        confidence: Math.min(0.9, spreadPct / 5),
        edge: Math.min(0.08, spreadPct / 100),
      };
    }

    return null;
  },
};

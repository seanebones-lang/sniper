/**
 * Order Book Imbalance Strategy
 * 
 * One of the higher-edge simple strategies in order-driven prediction markets.
 * Looks for significant pressure on one side of the book that hasn't been reflected in price yet.
 * 
 * This is more sophisticated than pure spread scalping.
 */

import type { Strategy, StrategyConfig, StrategyContext, StrategySignal } from './types';

export const OrderBookImbalance: Strategy = {
  id: 'orderbook-imbalance',
  name: 'Order Book Imbalance',
  type: 'orderbook-imbalance',

  evaluate(ctx, config): StrategySignal | null {
    const { book, currentPrice } = ctx;
    if (!book || !book.bids.length || !book.asks.length || !currentPrice) return null;

    const topBidSize = book.bids[0]?.size || 0;
    const topAskSize = book.asks[0]?.size || 0;
    const totalTop = topBidSize + topAskSize;

    if (totalTop < 50) return null;

    const bidPressure = topBidSize / totalTop;
    const askPressure = topAskSize / totalTop;

    const imbalance = bidPressure - askPressure;

    // Regime-aware thresholds (more aggressive in trending regimes)
    const regime = ((ctx as unknown) as Record<string, unknown>).regime as string || 'normal';
    let threshold = 0.35;

    if (regime === 'trending') threshold = 0.22;      // easier to trigger in strong moves
    if (regime === 'low_liquidity') threshold = 0.48; // much stricter in thin books

    if (Math.abs(imbalance) > threshold) {
      const direction = imbalance > 0 ? 'BUY' : 'SELL';
      const targetPrice = direction === 'BUY' 
        ? book.bids[0].price * 0.995
        : book.asks[0].price * 1.005;

      const size = (config.maxSizeUsd || 150) / targetPrice;
      const estimatedEdge = Math.min(0.09, Math.abs(imbalance) * 0.20);

      return {
        action: direction,
        price: targetPrice,
        size: Math.max(20, Math.floor(size)),
        reason: `Strong ${direction} imbalance ${(Math.abs(imbalance) * 100).toFixed(1)}% (regime: ${regime})`,
        confidence: Math.min(0.9, 0.55 + Math.abs(imbalance) * 0.95),
        edge: estimatedEdge,
      };
    }

    return null;
  },
};

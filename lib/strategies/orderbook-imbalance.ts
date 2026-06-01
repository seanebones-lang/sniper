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

    if (totalTop < 50) return null; // too thin, ignore

    const bidPressure = topBidSize / totalTop;
    const askPressure = topAskSize / totalTop;

    const imbalance = bidPressure - askPressure; // positive = buying pressure

    const threshold = 0.35; // quite strong imbalance required

    if (Math.abs(imbalance) > threshold) {
      const direction = imbalance > 0 ? 'BUY' : 'SELL';
      const targetPrice = direction === 'BUY' 
        ? book.bids[0].price * 0.995   // slight discount to get filled on the strong side
        : book.asks[0].price * 1.005;

      const size = (config.maxSizeUsd || 150) / targetPrice;

      return {
        action: direction,
        price: targetPrice,
        size: Math.max(20, Math.floor(size)),
        reason: `Strong ${direction} imbalance ${(Math.abs(imbalance) * 100).toFixed(1)}% (top of book)`,
        confidence: Math.min(0.85, Math.abs(imbalance) * 2),
      };
    }

    return null;
  },
};

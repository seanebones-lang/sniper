/**
 * Resolution Proximity Sniper
 * 
 * One of the most reliable small edges on short-duration prediction markets 
 * (especially 5m/15m/1h crypto markets on Polymarket).
 * 
 * Prices are often "soft" until very close to resolution. 
 * Strong directional moves frequently happen in the final 20-40% of a market's life.
 */

import type { Strategy, StrategySignal } from './types';

export const ResolutionProximitySniper: Strategy = {
  id: 'resolution-proximity',
  name: 'Resolution Proximity Sniper',
  type: 'resolution-proximity',

  evaluate(ctx, config): StrategySignal | null {
    const { market, book, currentPrice } = ctx;
    if (!currentPrice || !book) return null;

    let progress = Math.min(0.95, (market.volume || 0) / ((market.liquidity || 1000) * 8 + 1));

    if (market.endDate) {
      const end = new Date(market.endDate).getTime();
      const now = Date.now();
      if (end <= now) return null;
      const assumedStartMs = end - 3 * 3600_000;
      const totalMs = Math.max(end - assumedStartMs, 60_000);
      progress = Math.min(0.99, Math.max(0, (now - assumedStartMs) / totalMs));
    }

    // Only activate in the final 35% of the market's life
    if (progress < 0.65) return null;

    const timeLeftRatio = 1 - progress;
    const urgency = Math.pow(1 - timeLeftRatio, 1.8); // stronger signal as we get closer

    const imbalance = book.bids[0] && book.asks[0] 
      ? (book.bids[0].size - book.asks[0].size) / (book.bids[0].size + book.asks[0].size + 1)
      : 0;

    // Strong directional pressure near resolution is often actionable
    if (Math.abs(imbalance) > 0.28 && urgency > 0.4) {
      const direction = imbalance > 0 ? 'BUY' : 'SELL';
      const targetPrice = direction === 'BUY' 
        ? Math.max(0.01, book.bids[0].price * 0.992)
        : Math.min(0.99, book.asks[0].price * 1.008);

      return {
        action: direction,
        price: targetPrice,
        size: Math.floor((config.maxSizeUsd || 120) / targetPrice * urgency),
        reason: `Strong ${direction} pressure near resolution (progress ${(progress*100).toFixed(0)}%, imbalance ${(Math.abs(imbalance)*100).toFixed(1)}%)`,
        confidence: Math.min(0.82, 0.55 + urgency * 0.4 + Math.abs(imbalance) * 0.5),
        edge: Math.min(0.09, urgency * 0.07 + Math.abs(imbalance) * 0.06),
      };
    }

    return null;
  },
};

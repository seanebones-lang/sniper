import type { Strategy, StrategySignal } from './types';

export const ThresholdStrategy: Strategy = {
  id: 'threshold',
  name: 'Price Threshold',
  type: 'threshold',

  evaluate(ctx, config): StrategySignal | null {
    const { currentPrice } = ctx;
    if (!currentPrice) return null;

    const threshold = config.entryThreshold ?? 0.48; // buy if price < 48¢
    const targetProfit = config.targetProfitPct / 100;

    if (currentPrice <= threshold) {
      const size = config.maxSizeUsd / currentPrice;

      return {
        action: 'BUY',
        price: currentPrice,
        size: Math.floor(size),
        reason: `Price ${ (currentPrice*100).toFixed(1) }¢ ≤ threshold ${(threshold*100).toFixed(1)}¢`,
        confidence: 0.7,
      };
    }

    // Simple exit logic (for now just signal)
    if (currentPrice >= threshold + targetProfit) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: 100, // placeholder size
        reason: `Price reached target profit ${(targetProfit*100).toFixed(1)}%`,
        confidence: 0.65,
      };
    }

    return null;
  },
};

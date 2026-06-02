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

    // Simple exit logic — runner exit-engine handles most exits; this backs threshold type
    const targetPrice = threshold * (1 + targetProfit);

    if (currentPrice >= targetPrice) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.max(10, Math.floor(config.maxSizeUsd / currentPrice)),
        reason: `Price ${(currentPrice * 100).toFixed(1)}¢ ≥ target ${(targetPrice * 100).toFixed(1)}¢ (+${config.targetProfitPct}%)`,
        confidence: 0.65,
      };
    }

    return null;
  },
};

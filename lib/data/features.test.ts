import { describe, it, expect } from 'vitest';
import { extractFeaturesFromRecentSnapshots } from '@/lib/data/features';
import { runBacktest } from '@/lib/backtest/engine';

describe('extractFeaturesFromRecentSnapshots', () => {
  it('returns defaults for empty input', () => {
    const result = extractFeaturesFromRecentSnapshots([]);
    expect(result.regime).toBe('normal');
    expect(result.volatilityProxy).toBe(0);
  });

  it('detects high volatility regime', () => {
    const result = extractFeaturesFromRecentSnapshots([
      { mid: '0.40' },
      { mid: '0.50' },
    ]);
    expect(result.regime).toBe('high_volatility');
    expect(result.volatilityProxy).toBeCloseTo(0.1, 2);
  });
});

describe('runBacktest', () => {
  it('runs spread-scalper on synthetic prices', () => {
    const result = runBacktest({
      strategyType: 'spread-scalper',
      config: {
        maxSizeUsd: 100,
        targetProfitPct: 2.5,
        cooldownSeconds: 0,
        minSpreadPct: 0.5,
      },
      prices: [0.45, 0.46, 0.44],
    });
    expect(result).toHaveProperty('totalTrades');
    expect(result).toHaveProperty('totalPnl');
  });
});

import { describe, expect, it } from 'vitest';
import { resolveExitMarkPrice } from './exit-mark-price';
import { evaluateExitSignal } from '@/lib/strategies/exit-engine';
import { resolveStrategyConfig } from '@/lib/strategies/run-profile';
import type { StrategyOpenPosition } from '@/lib/strategies/exit-engine';

describe('resolveExitMarkPrice', () => {
  it('uses mid when top bid is a junk penny quote', () => {
    const mark = resolveExitMarkPrice({
      platform: 'polymarket',
      marketExternalId: 't',
      bids: [{ price: 0.002, size: 100 }],
      asks: [{ price: 0.28, size: 50 }],
      mid: 0.24,
      spread: 0.278,
      timestamp: new Date().toISOString(),
    });
    expect(mark).toBe(0.24);
  });
});

describe('evaluateExitSignal quick-flip exits', () => {
  const config = resolveStrategyConfig({
    tradingGoal: 'quick-flip',
    tradingStyle: 'aggressive',
    maxSizeUsd: 1,
    targetProfitMultiple: 1.5,
    stopLossPct: 12,
    maxHoldSeconds: 90,
  });

  const position: StrategyOpenPosition = {
    platform: 'polymarket',
    marketExternalId: 'tok',
    netSize: 4,
    avgEntryPrice: 0.26,
    openedAt: new Date(Date.now() - 120_000),
    strategyId: 's1',
  };

  it('does not stop out on healthy mid when still within stop and max hold', () => {
    const signal = evaluateExitSignal(
      { ...position, openedAt: new Date() },
      0.24,
      0.04,
      0.24,
      config,
    );
    expect(signal).toBeNull();
  });

  it('fires max-hold exit after maxHoldSeconds', () => {
    const signal = evaluateExitSignal(position, 0.24, 0.04, 0.24, config);
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/max hold 90s/);
  });

  it('fires take profit at 1.5× entry', () => {
    const signal = evaluateExitSignal(
      { ...position, openedAt: new Date() },
      0.39,
      0.02,
      0.39,
      config,
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/1\.5× hit/);
  });
});

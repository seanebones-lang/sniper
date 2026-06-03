import { describe, it, expect } from 'vitest';
import {
  normalizeStrategyConfig,
  resolveStrategyConfigForType,
} from './run-profile';

describe('normalizeStrategyConfigForType', () => {
  it('forces quick-flip + aggressive for live-quick-flip regardless of stored config', () => {
    const normalized = normalizeStrategyConfig('live-quick-flip', {
      tradingGoal: 'spread-capture',
      tradingStyle: 'balanced',
      maxSizeUsd: 1,
    });
    expect(normalized.tradingGoal).toBe('quick-flip');
    expect(normalized.tradingStyle).toBe('aggressive');
    expect(normalized.minEntryPrice).toBe(0.02);
    expect(normalized.maxHoldSeconds).toBe(180);
    expect(normalized.liveMarketsOnly).toBe(true);
  });

  it('resolveStrategyConfigForType yields aggressive entry fills for live-quick-flip', () => {
    const resolved = resolveStrategyConfigForType('live-quick-flip', {
      tradingGoal: 'spread-capture',
      tradingStyle: 'balanced',
      maxSizeUsd: 1,
    });
    expect(resolved.tradingGoal).toBe('quick-flip');
    expect(resolved.aggressiveEntryFills).toBe(true);
    expect(resolved.minEntryPrice).toBe(0.02);
    expect(resolved.maxHoldSeconds).toBe(180);
    expect(resolved.targetProfitMultiple).toBe(1.5);
    expect(resolved.stopLossPct).toBe(30);
  });

  it('does not alter non-quick-flip strategy types', () => {
    const normalized = normalizeStrategyConfig('spread-scalper', {
      tradingGoal: 'spread-capture',
      tradingStyle: 'balanced',
    });
    expect(normalized.tradingGoal).toBe('spread-capture');
    expect(normalized.tradingStyle).toBe('balanced');
  });
});

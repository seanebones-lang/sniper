import { describe, expect, it } from 'vitest';
import { evaluateExitSignal } from './exit-engine';
import { resolveStrategyConfig } from './run-profile';

const basePosition = {
  platform: 'polymarket',
  marketExternalId: 'm1',
  netSize: 100,
  avgEntryPrice: 0.1,
  openedAt: new Date('2026-01-01T00:00:00Z'),
  strategyId: 's1',
};

describe('evaluateExitSignal quick-flip', () => {
  const config = resolveStrategyConfig({
    maxSizeUsd: 1,
    targetProfitPct: 150,
    cooldownSeconds: 15,
    tradingGoal: 'quick-flip',
    tradingStyle: 'aggressive',
  });

  it('sells instantly at 2.5× entry price', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.25,
      0.01,
      0.25,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/2\.5×/);
  });

  it('sells when position USD value hits $2.50', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10, avgEntryPrice: 0.2 },
      0.25,
      0.01,
      0.25,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/\$2\.50/);
  });

  it('does not exit before target on quick-flip', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.12,
      0.01,
      0.12,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal).toBeNull();
  });
});

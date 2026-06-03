import { describe, expect, it } from 'vitest';
import {
  evaluateExitSignal,
  QUICK_FLIP_CATASTROPHIC_STOP_PCT,
  QUICK_FLIP_RESOLUTION_EXIT_MINUTES,
} from './exit-engine';
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
    targetProfitPct: 50,
    cooldownSeconds: 15,
    tradingGoal: 'quick-flip',
    tradingStyle: 'aggressive',
  });

  it('sells at 1.5× entry price', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.15,
      0.01,
      0.15,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/1\.5×|\$1\.50/);
  });

  it('does not exit at 1.4× (below 1.5× target)', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.14,
      0.01,
      0.14,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal).toBeNull();
  });

  it('sells when position USD value hits $1.50', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10, avgEntryPrice: 0.1 },
      0.15,
      0.01,
      0.15,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/\$1\.50/);
  });

  it('stop loss at -30%', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.07,
      0.01,
      0.07,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/Stop loss/);
  });

  it('catastrophic stop at -80%', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.019,
      0.01,
      0.019,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(new RegExp(`-${QUICK_FLIP_CATASTROPHIC_STOP_PCT}%`));
  });

  it('pre-resolution exit when red within 30 minutes of end', () => {
    const end = new Date('2026-01-01T01:00:00Z');
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.09,
      0.01,
      0.09,
      config,
      Date.parse('2026-01-01T00:45:00Z'),
      end.toISOString(),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/Pre-resolution/);
    expect(QUICK_FLIP_RESOLUTION_EXIT_MINUTES).toBe(30);
  });

  it('does not time-exit quick-flip when flat and young', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.1,
      0.01,
      0.1,
      config,
      Date.parse('2026-01-01T00:10:00Z'),
    );
    expect(signal).toBeNull();
  });
});

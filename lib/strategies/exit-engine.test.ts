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

  it('sells at 1.2× entry price', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.12,
      0.01,
      0.12,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/1\.2×|\$1\.20/);
  });

  it('does not exit at 1.1× (below 1.2× target)', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.11,
      0.01,
      0.11,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal).toBeNull();
  });

  it('sells when position USD value hits $1.15', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10, avgEntryPrice: 0.1 },
      0.115,
      0.01,
      0.115,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/\$1\.15/);
  });

  it('stop loss at -15%', () => {
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

  it('max-hold exits quick-flip after maxHoldSeconds even when flat', () => {
    const signal = evaluateExitSignal(
      { ...basePosition, netSize: 10 },
      0.1,
      0.01,
      0.1,
      config,
      Date.parse('2026-01-01T00:10:00Z'),
    );
    expect(signal?.action).toBe('SELL');
    expect(signal?.reason).toMatch(/max hold/);
  });
});

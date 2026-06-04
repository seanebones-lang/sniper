import { describe, it, expect } from 'vitest';
import { aggregateRealPositions } from './real-positions';
import { evaluateExitSignal } from '@/lib/strategies/exit-engine';
import { resolveStrategyConfig } from '@/lib/strategies/run-profile';

function row(side: string, size: number, price: number, atIso: string) {
  return {
    platform: 'polymarket',
    marketExternalId: 'token-abc',
    side,
    size: String(size),
    price: String(price),
    at: new Date(atIso),
  };
}

describe('aggregateRealPositions', () => {
  it('returns a net long with weighted-average entry and earliest openedAt', () => {
    const positions = aggregateRealPositions(
      [
        row('BUY', 10, 0.1, '2026-01-01T00:00:00Z'),
        row('BUY', 10, 0.2, '2026-01-01T00:00:05Z'),
      ],
      's1',
    );
    expect(positions).toHaveLength(1);
    expect(positions[0].netSize).toBeCloseTo(20);
    expect(positions[0].avgEntryPrice).toBeCloseTo(0.15);
    expect(positions[0].openedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(positions[0].strategyId).toBe('s1');
  });

  it('treats a fully-sold market as closed (no open position)', () => {
    const positions = aggregateRealPositions(
      [
        row('BUY', 10, 0.1, '2026-01-01T00:00:00Z'),
        row('SELL', 10, 0.25, '2026-01-01T00:01:00Z'),
      ],
      's1',
    );
    expect(positions).toHaveLength(0);
  });

  it('keeps the residual open after a partial sell', () => {
    const positions = aggregateRealPositions(
      [
        row('BUY', 10, 0.1, '2026-01-01T00:00:00Z'),
        row('SELL', 6, 0.25, '2026-01-01T00:01:00Z'),
      ],
      's1',
    );
    expect(positions).toHaveLength(1);
    expect(positions[0].netSize).toBeCloseTo(4);
  });

  it('filters dust residue when applyFilters is true (default)', () => {
    const positions = aggregateRealPositions(
      [row('BUY', 0.2, 0.4, '2026-01-01T00:00:00Z')],
      's1',
    );
    expect(positions).toHaveLength(0);
  });

  it('includes dust when applyFilters is false (heal path)', () => {
    const positions = aggregateRealPositions(
      [row('BUY', 0.2, 0.4, '2026-01-01T00:00:00Z')],
      's1',
      { applyFilters: false },
    );
    expect(positions).toHaveLength(1);
  });

  it('ignores rows with unparseable numbers', () => {
    const positions = aggregateRealPositions(
      [
        row('BUY', 10, 0.1, '2026-01-01T00:00:00Z'),
        { ...row('BUY', 0, 0, '2026-01-01T00:00:05Z'), size: 'NaN', price: 'NaN' },
      ],
      's1',
    );
    expect(positions[0].netSize).toBeCloseTo(10);
  });
});

describe('real buy -> exit round-trip (the unblocker)', () => {
  const config = resolveStrategyConfig({
    maxSizeUsd: 1,
    targetProfitPct: 150,
    cooldownSeconds: 15,
    tradingGoal: 'quick-flip',
    tradingStyle: 'aggressive',
  });

  it('a real fill becomes an open position that fires a take-profit SELL at 1.5×', () => {
    const [position] = aggregateRealPositions(
      [row('BUY', 10, 0.1, '2026-01-01T00:00:00Z')],
      's1',
    );
    expect(position.netSize).toBeCloseTo(10);
    expect(position.avgEntryPrice).toBeCloseTo(0.1);

    const exit = evaluateExitSignal(
      position,
      0.15,
      0.01,
      0.15,
      config,
      Date.parse('2026-01-01T00:00:30Z'),
    );
    expect(exit?.action).toBe('SELL');
    expect(exit?.size).toBeGreaterThan(0);
  });

  it('does not emit an exit while the position is still below target', () => {
    const [position] = aggregateRealPositions(
      [row('BUY', 10, 0.1, '2026-01-01T00:00:00Z')],
      's1',
    );
    const exit = evaluateExitSignal(
      position,
      0.12,
      0.01,
      0.12,
      config,
      Date.parse('2026-01-01T00:00:05Z'),
    );
    expect(exit).toBeNull();
  });
});

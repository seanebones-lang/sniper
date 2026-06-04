import { describe, expect, it } from 'vitest';
import { roundTripsFromEvents } from './real-strategy-pnl';

describe('roundTripsFromEvents', () => {
  it('closes a round trip on sell that flattens position', () => {
    const t0 = new Date('2026-06-01T10:00:00Z');
    const t1 = new Date('2026-06-01T10:05:00Z');
    const trips = roundTripsFromEvents([
      {
        strategyId: 'strat-1',
        platform: 'polymarket',
        marketExternalId: 'token-abc',
        side: 'BUY',
        size: 10,
        price: 0.4,
        fee: 0,
        at: t0,
      },
      {
        strategyId: 'strat-1',
        platform: 'polymarket',
        marketExternalId: 'token-abc',
        side: 'SELL',
        size: 10,
        price: 0.5,
        fee: 0.01,
        at: t1,
      },
    ]);
    expect(trips).toHaveLength(1);
    expect(trips[0].pnlUsd).toBeCloseTo(0.99, 2);
    expect(trips[0].avgEntry).toBeCloseTo(0.4, 3);
    expect(trips[0].avgExit).toBeCloseTo(0.5, 3);
    expect(trips[0].holdMs).toBe(5 * 60 * 1000);
    expect(trips[0].buyCount).toBe(1);
    expect(trips[0].sellCount).toBe(1);
  });
});

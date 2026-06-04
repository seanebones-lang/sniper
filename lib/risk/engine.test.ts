import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the DB so exposure/daily-loss logic is deterministic and offline.
vi.mock('@/lib/execution/real-positions', () => ({
  getRealOpenPositionsByStrategy: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/lib/db', () => {
  const chain = {
    values: () => ({
      onConflictDoUpdate: async () => undefined,
      returning: async () => [],
    }),
  };
  return {
    db: {
      query: {
        positions: { findMany: vi.fn().mockResolvedValue([]) },
        realTrades: { findMany: vi.fn().mockResolvedValue([]) },
        strategies: { findMany: vi.fn().mockResolvedValue([{ id: 'live-1' }]) },
      },
      insert: () => chain,
      execute: vi.fn().mockResolvedValue([]),
    },
    systemState: {},
    auditEvents: {},
    positions: {},
    realTrades: {},
  };
});

import { riskEngine } from './engine';
import { db } from '@/lib/db';

describe('riskEngine daily-loss restore + breaker', () => {
  beforeEach(() => {
    riskEngine.resetDailyLoss();
  });

  it('restoreDailyLoss rehydrates tracked loss so the breaker survives a restart', () => {
    riskEngine.restoreDailyLoss(120, new Date().toISOString());
    expect(riskEngine.getCurrentDailyLoss()).toBeCloseTo(120);

    const result = riskEngine.checkRisk(
      { platform: 'polymarket', marketExternalId: 'm', side: 'BUY', price: 0.5, size: 2, usdValue: 1 },
      { dailyLossLimitUsd: 100 },
    );
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily loss limit');
  });

  it('does not lower tracked loss with a non-positive value', () => {
    riskEngine.restoreDailyLoss(50);
    riskEngine.restoreDailyLoss(0);
    expect(riskEngine.getCurrentDailyLoss()).toBeCloseTo(50);
  });
});

describe('riskEngine real-exposure gate', () => {
  beforeEach(() => {
    (db.query.positions.findMany as any).mockResolvedValue([]);
    (db.query.realTrades.findMany as any).mockResolvedValue([]);
  });

  it('blocks an entry that would breach the total exposure cap', async () => {
    const res = await riskEngine.checkRealExposure(
      { platform: 'polymarket', marketExternalId: 'm', side: 'BUY', price: 0.6, size: 1000, usdValue: 600 },
      { maxUsdTotalExposure: 500 },
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('total cap');
  });

  it('allows a small entry within caps', async () => {
    const res = await riskEngine.checkRealExposure({
      platform: 'polymarket',
      marketExternalId: 'm',
      side: 'BUY',
      price: 0.6,
      size: 10,
      usdValue: 6,
    });
    expect(res.allowed).toBe(true);
  });

  it('never blocks an exit', async () => {
    const res = await riskEngine.checkRealExposure({
      platform: 'polymarket',
      marketExternalId: 'm',
      side: 'SELL',
      price: 0.6,
      size: 100000,
      usdValue: 999999,
      isExit: true,
    });
    expect(res.allowed).toBe(true);
  });

  it('aggregates open positions into per-market exposure', async () => {
    const { getRealOpenPositionsByStrategy } = await import('@/lib/execution/real-positions');
    vi.mocked(getRealOpenPositionsByStrategy).mockResolvedValue(
      new Map([
        [
          'live-1',
          [
            {
              platform: 'polymarket',
              marketExternalId: 'mkt-1',
              netSize: 100,
              avgEntryPrice: 0.5,
              openedAt: new Date(),
              strategyId: 'live-1',
            },
          ],
        ],
      ]),
    );
    const exposure = await riskEngine.getRealExposure();
    expect(exposure.totalUsd).toBeCloseTo(50);
    expect(exposure.byMarket['polymarket:mkt-1']).toBeCloseTo(50);
    expect(exposure.openCount).toBe(1);
  });
});

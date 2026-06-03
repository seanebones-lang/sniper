import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database layer used by PortfolioRiskManager
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      realTrades: {
        findMany: vi.fn(),
      },
      paperTrades: {
        findMany: vi.fn(),
      },
    },
  },
  positions: {},
  realTrades: {},
  paperTrades: {},
}));

import { PortfolioRiskManager, RiskParameters } from './portfolio-manager';
import { db } from '@/lib/db';

describe('PortfolioRiskManager', () => {
  let riskManager: PortfolioRiskManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: empty recent trades
    (db.query.realTrades.findMany as any).mockResolvedValue([]);
    (db.query.paperTrades.findMany as any).mockResolvedValue([]);

    riskManager = new PortfolioRiskManager({}, 10000); // $10k starting bankroll
  });

  it('should use conservative default risk parameters', () => {
    const params = (riskManager as any).params as RiskParameters;
    expect(params.maxTotalExposureUsd).toBe(2000);
    expect(params.kellyFraction).toBe(0.25);
    expect(params.maxSingleMarketExposureUsd).toBe(250);
  });

  it('should block trades when daily loss limit is reached', async () => {
    // Mock a bad day
    (db.query.realTrades.findMany as any).mockResolvedValue([
      { size: '100', price: '0.5', createdAt: new Date() }, // simulates loss context
    ]);

    // Force dailyPnl to be very negative by overriding internal state for test
    (riskManager as any).getCurrentPortfolioState = async () => ({
      totalExposureUsd: 100,
      dailyPnl: -200, // exceeds maxDailyLossUsd of 150
      maxDrawdown: 0,
      openPositions: 1,
      categoryExposures: {},
    });

    const result = await riskManager.calculateSafeSize({
      platform: 'polymarket',
      marketExternalId: 'test-market',
      side: 'BUY',
      edge: 0.05,
      confidence: 0.7,
      currentPrice: 0.5,
    });

    expect(result.allowedSize).toBe(0);
    expect(result.reason).toContain('Daily loss limit');
  });

  it('should apply conservative Kelly sizing under normal conditions', async () => {
    // Ensure clean portfolio state for this test
    (riskManager as any).getCurrentPortfolioState = async () => ({
      totalExposureUsd: 50,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 1,
      categoryExposures: { crypto: 50 },
    });

    const result = await riskManager.calculateSafeSize({
      platform: 'polymarket',
      marketExternalId: 'good-edge',
      side: 'BUY',
      edge: 0.08, // strong edge
      confidence: 0.8,
      category: 'crypto',
      currentPrice: 0.6,
    });

    // Regression: a realistic positive edge must produce a tradeable size.
    // Previously the degenerate Kelly mapping returned 0 here, silently blocking
    // every entry signal at the runner's `allowedSize < minAllowedUsd` guard.
    expect(result.allowedSize).toBeGreaterThan(5);
    expect(typeof result.reason).toBe('string');
  });

  it('sizes monotonically with edge (regression for degenerate Kelly)', async () => {
    (riskManager as any).getCurrentPortfolioState = async () => ({
      totalExposureUsd: 0,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 0,
      categoryExposures: {},
    });

    const common = {
      platform: 'polymarket' as const,
      marketExternalId: 'mono',
      side: 'BUY' as const,
      confidence: 0.7,
      category: 'other',
      currentPrice: 0.5,
    };
    const small = await riskManager.calculateSafeSize({ ...common, edge: 0.05 });
    const big = await riskManager.calculateSafeSize({ ...common, edge: 0.2 });

    expect(small.allowedSize).toBeGreaterThan(0);
    expect(big.allowedSize).toBeGreaterThan(small.allowedSize);
  });

  it('zero edge still yields zero size', async () => {
    (riskManager as any).getCurrentPortfolioState = async () => ({
      totalExposureUsd: 0,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 0,
      categoryExposures: {},
    });

    const result = await riskManager.calculateSafeSize({
      platform: 'polymarket',
      marketExternalId: 'no-edge',
      side: 'BUY',
      edge: 0,
      confidence: 0.65,
      category: 'other',
      currentPrice: 0.5,
    });

    expect(result.allowedSize).toBe(0);
  });

  it('should respect category exposure limits', async () => {
    (riskManager as any).getCurrentPortfolioState = async () => ({
      totalExposureUsd: 100,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 2,
      categoryExposures: { crypto: 650 }, // already near/over limit of 600
    });

    const result = await riskManager.calculateSafeSize({
      platform: 'polymarket',
      marketExternalId: 'crypto-market',
      side: 'BUY',
      edge: 0.06,
      confidence: 0.75,
      category: 'crypto',
      currentPrice: 0.5,
    });

    expect(result.allowedSize).toBe(0);
    expect(result.reason).toContain('Category crypto exposure limit');
  });

  it('should cap size by single market and remaining portfolio limits', async () => {
    const result = await riskManager.calculateSafeSize({
      platform: 'polymarket',
      marketExternalId: 'large-edge',
      side: 'BUY',
      edge: 0.12,
      confidence: 0.9,
      category: 'politics',
      currentPrice: 0.4,
    });

    expect(result.allowedSize).toBeLessThanOrEqual(250); // maxSingleMarketExposureUsd
  });

  it('should record outcomes and adjust bankroll', async () => {
    const initialBankroll = (riskManager as any).currentBankroll;
    await riskManager.recordOutcome(250);
    const newBankroll = (riskManager as any).currentBankroll;

    expect(newBankroll).toBe(initialBankroll + 250);
  });

  it('should track maxDrawdown after losing trades', async () => {
    // Reset to clean state
    (riskManager as any).currentBankroll = 10000;
    (riskManager as any).peakBankroll = 10000;
    (riskManager as any).currentDrawdownPct = 0;

    await riskManager.recordOutcome(-1500); // 15% drawdown
    const dd = riskManager.getCurrentDrawdownPct();

    expect(dd).toBeGreaterThan(0.14);
    expect(dd).toBeLessThan(0.16);
  });

  it('drawdown rises during a loss and recovers as equity returns (not a one-way latch)', () => {
    const m = new PortfolioRiskManager({}, 100);
    const state = () => ({
      totalExposureUsd: 0,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 0,
      categoryExposures: {},
    });

    m.setCyclePortfolioState(state(), 100);
    expect(m.getCurrentDrawdownPct()).toBeCloseTo(0);

    // Equity falls to 80 → 20% drawdown from the 100 peak.
    m.setCyclePortfolioState(state(), 80);
    expect(m.getCurrentDrawdownPct()).toBeCloseTo(0.2);

    // Equity recovers to 100 → drawdown releases back to 0.
    m.setCyclePortfolioState(state(), 100);
    expect(m.getCurrentDrawdownPct()).toBeCloseTo(0);
  });

  it('applyMicroRealBudget clears paper HWM so live micro is not drawdown-blocked', () => {
    const m = new PortfolioRiskManager({}, 10000);
    m.restoreDrawdownState(10000, 0.25);
    expect(m.getPeakBankroll()).toBe(10000);

    m.applyMicroRealBudget(13.77);
    expect(m.getCurrentBankroll()).toBeCloseTo(13.77);
    expect(m.getPeakBankroll()).toBeCloseTo(13.77);
    expect(m.getCurrentDrawdownPct()).toBe(0);
  });

  it('restoreDrawdownState lifts the high-water mark so a redeploy does not reset the breaker', () => {
    const m = new PortfolioRiskManager({}, 100);
    m.restoreDrawdownState(200, 0.1);

    const state = {
      totalExposureUsd: 0,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 0,
      categoryExposures: {},
    };
    // Peak is now 200; equity 180 ⇒ 10% drawdown vs the restored peak.
    m.setCyclePortfolioState(state, 180);
    expect(m.getCurrentDrawdownPct()).toBeCloseTo(0.1);
  });

  it('should return zero size when total exposure limit is reached', async () => {
    (riskManager as any).getCurrentPortfolioState = async () => ({
      totalExposureUsd: 2100, // over the 2000 limit
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: 10,
      categoryExposures: {},
    });

    const result = await riskManager.calculateSafeSize({
      platform: 'kalshi',
      marketExternalId: 'any',
      side: 'BUY',
      edge: 0.05,
      confidence: 0.6,
      currentPrice: 0.5,
    });

    expect(result.allowedSize).toBe(0);
    expect(result.reason).toContain('Total portfolio exposure');
  });
});

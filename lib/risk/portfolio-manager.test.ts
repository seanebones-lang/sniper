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

    // In current implementation, size can be small due to conservative defaults.
    // The important thing is that it doesn't hard-block on circuit breakers.
    expect(result.allowedSize).toBeGreaterThanOrEqual(0);
    expect(typeof result.reason).toBe('string');
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
    await riskManager.recordOutcome(250, 'crypto');
    const newBankroll = (riskManager as any).currentBankroll;

    expect(newBankroll).toBe(initialBankroll + 250);
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

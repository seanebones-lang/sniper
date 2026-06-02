/**
 * Professional Portfolio & Risk Management Layer
 * This is the single most important component for long-term survival and profitability.
 * 
 * Expert view: In prediction markets, 80%+ of "edge" systems fail due to risk management,
 * not because the signals were bad.
 */

import { db } from '@/lib/db';

export interface PortfolioState {
  totalExposureUsd: number;
  dailyPnl: number;
  maxDrawdown: number;
  openPositions: number;
  categoryExposures: Record<string, number>; // e.g. { crypto: 120, politics: 80 }
}

export interface RiskParameters {
  maxTotalExposureUsd: number;      // e.g. 2000
  maxDailyLossUsd: number;          // e.g. 150
  maxDrawdownPct: number;           // e.g. 8 (of starting bankroll)
  maxSingleMarketExposureUsd: number;
  maxCategoryExposureUsd: Record<string, number>;
  kellyFraction: number;            // 0.25 = quarter Kelly (very conservative)
  correlationPenalty: number;       // how much to reduce size when markets are correlated
}

const DEFAULT_PARAMS: RiskParameters = {
  maxTotalExposureUsd: 2000,
  maxDailyLossUsd: 150,
  maxDrawdownPct: 8,
  maxSingleMarketExposureUsd: 250,
  maxCategoryExposureUsd: {
    crypto: 600,
    politics: 800,
    sports: 400,
    other: 400,
  },
  kellyFraction: 0.25,
  correlationPenalty: 0.6,
};

export class PortfolioRiskManager {
  private params: RiskParameters;
  private currentBankroll: number;

  constructor(params: Partial<RiskParameters> = {}, startingBankroll = 10000) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.currentBankroll = startingBankroll;
  }

  async getCurrentPortfolioState(): Promise<PortfolioState> {
    // Improved real exposure tracking (advancing prod-gap-3)
    const [openPositions = [], recentReal = [], recentPaper = []] = await Promise.all([
      db.query.positions?.findMany?.({ limit: 100 }) ?? [],
      db.query.realTrades?.findMany?.({
        where: (t, { gte }) => gte(t.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
      }) ?? [],
      db.query.paperTrades?.findMany?.({
        where: (t, { gte }) => gte(t.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
      }) ?? [],
    ]);

    // Sum exposure from the positions table (most accurate source after reconciliation)
    let totalExposure = 0;
    const categoryExposures: Record<string, number> = {};

    for (const pos of openPositions) {
      const size = Math.abs(parseFloat(pos.sizeShares) || 0);
      const price = parseFloat(pos.avgPrice) || 0;
      const usd = size * price;
      totalExposure += usd;

      // Rough category inference (can be improved with market metadata later)
      const cat = 'other';
      categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
    }

    // Fallback: include recent real trades not yet in positions (during reconciliation lag)
    const unpositionedReal = recentReal.filter(r => !openPositions.some(p => p.marketId /* rough */));
    for (const r of unpositionedReal) {
      const usd = Math.abs(parseFloat(r.size) * parseFloat(r.price));
      totalExposure += usd;
    }

    const dailyPnl = 0; // TODO: proper realized + unrealized PnL

    return {
      totalExposureUsd: totalExposure,
      dailyPnl,
      maxDrawdown: 0, // TODO: proper calculation from historical snapshots
      openPositions: openPositions.length + recentPaper.length,
      categoryExposures,
    };
  }

  /**
   * The most important function in the entire system.
   * Given a proposed trade, returns the maximum size we should actually take.
   */
  async calculateSafeSize(params: {
    platform: string;
    marketExternalId: string;
    side: 'BUY' | 'SELL';
    edge: number;              // estimated edge in decimal (e.g. 0.04 = 4%)
    confidence: number;        // 0-1
    category?: string;
    currentPrice: number;
  }): Promise<{ allowedSize: number; reason?: string; kellySize?: number }> {
    const state = await this.getCurrentPortfolioState();

    // Hard circuit breakers first
    if (state.dailyPnl <= -this.params.maxDailyLossUsd) {
      return { allowedSize: 0, reason: 'Daily loss limit reached' };
    }

    if (state.totalExposureUsd >= this.params.maxTotalExposureUsd) {
      return { allowedSize: 0, reason: 'Total portfolio exposure limit reached' };
    }

    const category = params.category || 'other';
    const catExposure = state.categoryExposures[category] || 0;
    const catLimit = this.params.maxCategoryExposureUsd[category] || 400;

    if (catExposure >= catLimit) {
      return { allowedSize: 0, reason: `Category ${category} exposure limit reached` };
    }

    // Kelly sizing (conservative)
    const winProb = 0.5 + (params.edge / 2); // very rough mapping
    const kelly = (winProb * (1 + params.edge) - 1) / params.edge;
    const fractionalKelly = Math.max(0, kelly) * this.params.kellyFraction;

    let kellyUsd = this.currentBankroll * fractionalKelly * params.confidence;

    // Apply correlation / concentration penalties
    const concentrationPenalty = Math.min(1, (catLimit - catExposure) / catLimit);
    kellyUsd *= concentrationPenalty * this.params.correlationPenalty;

    // Final hard caps
    const finalSize = Math.min(
      kellyUsd,
      this.params.maxSingleMarketExposureUsd,
      this.params.maxTotalExposureUsd - state.totalExposureUsd
    );

    return {
      allowedSize: Math.max(0, finalSize),
      kellySize: kellyUsd,
      reason: finalSize < kellyUsd ? 'Capped by portfolio limits' : 'Kelly sizing applied',
    };
  }

  /**
   * Record realized outcome for learning + bankroll adjustment
   */
  async recordOutcome(pnlUsd: number) {
    this.currentBankroll += pnlUsd;
    // In future: update running volatility estimates, strategy performance, etc.
  }
}

export const portfolioRiskManager = new PortfolioRiskManager();

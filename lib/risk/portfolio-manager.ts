/**
 * Professional Portfolio & Risk Management Layer
 * This is the single most important component for long-term survival and profitability.
 * 
 * Expert view: In prediction markets, 80%+ of "edge" systems fail due to risk management,
 * not because the signals were bad.
 */

import { db } from '@/lib/db';
import type { PaperBudgetSettings } from '@/lib/settings/paper-budget';
import { categorizeMarket, getCategoryLimits } from './categorizer';
import { minRealOrderUsd } from './sizing';

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
  private peakBankroll: number;
  private currentDrawdownPct: number = 0;
  /** Per-runner-cycle cache; avoids N DB round-trips per signal */
  private cycleStateCache: PortfolioState | null = null;
  private lastRealizedPnLUsd = 0;

  constructor(params: Partial<RiskParameters> = {}, startingBankroll = 10000) {
    this.params = { ...DEFAULT_PARAMS, ...params };
    this.currentBankroll = startingBankroll;
    this.peakBankroll = startingBankroll;
  }

  /** Set paper-derived state once per runner cycle (from ledger + MTM). */
  setCyclePortfolioState(state: PortfolioState, equityUsd: number, realizedPnLUsd?: number) {
    this.cycleStateCache = state;
    this.currentBankroll = equityUsd;
    if (this.peakBankroll < equityUsd) {
      this.peakBankroll = equityUsd;
    }
    // Current drawdown vs all-time peak. This is recoverable (rises as equity
    // falls, falls as equity recovers) so the breaker engages during a real
    // drawdown and releases afterward — not a one-way latch.
    const drawdown =
      this.peakBankroll > 0 ? (this.peakBankroll - equityUsd) / this.peakBankroll : 0;
    this.currentDrawdownPct = Math.max(0, drawdown);
    state.maxDrawdown = this.currentDrawdownPct;

    if (realizedPnLUsd != null) {
      const delta = realizedPnLUsd - this.lastRealizedPnLUsd;
      if (Math.abs(delta) > 0.001) {
        this.lastRealizedPnLUsd = realizedPnLUsd;
      }
    }
  }

  clearCycleCache() {
    this.cycleStateCache = null;
  }

  async getCurrentPortfolioState(): Promise<PortfolioState> {
    if (this.cycleStateCache) {
      return { ...this.cycleStateCache, maxDrawdown: this.currentDrawdownPct };
    }

    // Fallback: try paper ledger when positions table is empty (paper mode)
    try {
      const { loadPaperRiskState } = await import('@/lib/paper/risk-state');
      const paper = await loadPaperRiskState();
      const state = { ...paper.state, maxDrawdown: this.currentDrawdownPct };
      this.currentBankroll = paper.equityUsd;
      return state;
    } catch {
      // fall through to legacy real-position path
    }
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

      // Use the real categorizer for accurate bucketing
      // We don't have the question here, so we use a lightweight fallback + externalId
      const catResult = categorizeMarket('', pos.platform, pos.marketId);
      const cat = catResult.category;
      categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
    }

    // Fallback: include recent real trades not yet in positions (during reconciliation lag)
    const unpositionedReal = recentReal.filter(r => 
      !openPositions.some(p => p.marketId === r.marketExternalId || p.platform === r.platform)
    );
    for (const r of unpositionedReal) {
      const usd = Math.abs(parseFloat(r.size) * parseFloat(r.price));
      totalExposure += usd;

      const catResult = categorizeMarket('', r.platform, r.marketExternalId);
      const cat = catResult.category;
      categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
    }

    const dailyPnl = 0;

    return {
      totalExposureUsd: totalExposure,
      dailyPnl,
      maxDrawdown: this.currentDrawdownPct,
      openPositions: openPositions.length,
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
    edge: number;
    confidence: number;
    category?: string;
    currentPrice: number;
    /** When true, skip circuit breakers so exits are not blocked by exposure limits */
    isExit?: boolean;
  }): Promise<{ allowedSize: number; reason?: string; kellySize?: number }> {
    const state = await this.getCurrentPortfolioState();

    if (!params.isExit) {
      if (state.dailyPnl <= -this.params.maxDailyLossUsd) {
        return { allowedSize: 0, reason: 'Daily loss limit reached' };
      }

      if (state.totalExposureUsd >= this.params.maxTotalExposureUsd) {
        return { allowedSize: 0, reason: 'Total portfolio exposure limit reached' };
      }

      if (state.maxDrawdown >= this.params.maxDrawdownPct / 100) {
        return { allowedSize: 0, reason: `Max drawdown limit reached (${(state.maxDrawdown * 100).toFixed(1)}%)` };
      }
    }

    const rawCategory = params.category || categorizeMarket('', params.platform, params.marketExternalId).category;
    const category = rawCategory as keyof typeof this.params.maxCategoryExposureUsd;
    const catExposure = state.categoryExposures[category] || 0;
    const dynamicLimits = getCategoryLimits ? getCategoryLimits() : this.params.maxCategoryExposureUsd;
    const catLimit = (dynamicLimits as any)[category] || this.params.maxCategoryExposureUsd[category] || 400;

    if (!params.isExit && catExposure >= catLimit) {
      return { allowedSize: 0, reason: `Category ${category} exposure limit reached` };
    }

    if (params.isExit && params.side === 'SELL') {
      return {
        allowedSize: this.params.maxSingleMarketExposureUsd,
        reason: 'Exit — circuit breakers bypassed',
      };
    }

    // Fractional-Kelly sizing (conservative). `edge` is the expected return
    // fraction on the position; we stake proportionally to it.
    //
    // NOTE: the previous mapping (winProb = 0.5 + edge/2; kelly =
    // (winProb*(1+edge)-1)/edge) was mathematically degenerate — it only turns
    // positive for edge > ~0.41 (41%), which no real strategy emits (strategies
    // emit edges of ~0.03–0.30). The result was allowedSize = 0 for every entry
    // signal, silently blocking ALL entries (paper and real) at the runner's
    // `allowedSize < minAllowedUsd` guard. Staking proportional to edge keeps
    // sizing positive and monotonic; the hard portfolio caps below still bound it.
    const safeEdge = Math.max(0, params.edge);
    const fractionalKelly = safeEdge * this.params.kellyFraction;

    let kellyUsd = this.currentBankroll * fractionalKelly * params.confidence;

    // Apply correlation / concentration penalties
    const concentrationPenalty = Math.min(1, (catLimit - catExposure) / catLimit);
    kellyUsd *= concentrationPenalty * this.params.correlationPenalty;

    // Final hard caps
    let finalSize = Math.min(
      kellyUsd,
      this.params.maxSingleMarketExposureUsd,
      this.params.maxTotalExposureUsd - state.totalExposureUsd
    );

    // Micro bankrolls: Kelly can be below exchange minimum even with a valid signal.
    const minUsd = minRealOrderUsd(this.currentBankroll);
    const microAccount = this.currentBankroll <= 25;
    const edgeScore = params.edge * params.confidence;
    const edgeOk = microAccount ? edgeScore >= 0.01 : edgeScore >= 0.08;
    if (
      !params.isExit &&
      finalSize < minUsd &&
      state.totalExposureUsd < this.params.maxTotalExposureUsd &&
      catExposure < catLimit &&
      edgeOk
    ) {
      const headroom = this.params.maxTotalExposureUsd - state.totalExposureUsd;
      finalSize = Math.min(
        this.params.maxSingleMarketExposureUsd,
        headroom,
        Math.max(finalSize, minUsd),
      );
    }

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

    // Basic maxDrawdown tracking
    if (this.currentBankroll > this.peakBankroll) {
      this.peakBankroll = this.currentBankroll;
    }

    const drawdown = this.peakBankroll > 0 
      ? (this.peakBankroll - this.currentBankroll) / this.peakBankroll 
      : 0;

    this.currentDrawdownPct = Math.max(this.currentDrawdownPct, drawdown);

    // In future: update running volatility estimates, strategy performance, etc.
  }

  getCurrentDrawdownPct(): number {
    return this.currentDrawdownPct;
  }

  getPeakBankroll(): number {
    return this.peakBankroll;
  }

  applyBudgetSettings(budget: PaperBudgetSettings) {
    this.params.maxTotalExposureUsd = budget.maxExposureUsd;
    this.params.maxDailyLossUsd = budget.maxDailyLossUsd;
    // User-set max open exposure caps both total book and per-entry size.
    this.params.maxSingleMarketExposureUsd = Math.max(0.5, budget.maxExposureUsd);
    this.currentBankroll = budget.paperBudgetUsd;
    // Peak persists across cycles so the drawdown breaker measures drawdown from
    // the true equity high-water mark, not just the per-cycle budget. (Use
    // resetDrawdown() to clear it for a genuinely new run.)
    this.peakBankroll = Math.max(this.peakBankroll, budget.paperBudgetUsd);
  }

  /** Clear drawdown tracking for a brand-new run/session. */
  resetDrawdown(startingBankroll?: number) {
    if (startingBankroll != null && startingBankroll > 0) {
      this.currentBankroll = startingBankroll;
      this.peakBankroll = startingBankroll;
    } else {
      this.peakBankroll = this.currentBankroll;
    }
    this.currentDrawdownPct = 0;
  }

  /** Restore drawdown high-water mark on startup so a redeploy doesn't reset the breaker. */
  restoreDrawdownState(peakBankroll?: number, currentDrawdownPct?: number) {
    if (peakBankroll != null && peakBankroll > 0) {
      this.peakBankroll = Math.max(this.peakBankroll, peakBankroll);
    }
    if (currentDrawdownPct != null && currentDrawdownPct > this.currentDrawdownPct) {
      this.currentDrawdownPct = currentDrawdownPct;
    }
  }

  /** Live Polymarket micro account (~$7): use real CLOB cash, not paper $10k defaults. */
  applyMicroRealBudget(balanceUsd: number) {
    const b = Math.max(0.5, balanceUsd);
    this.currentBankroll = b;
    if (this.peakBankroll < b) this.peakBankroll = b;
    this.params.maxTotalExposureUsd = Math.max(1, b * 0.95);
    this.params.maxSingleMarketExposureUsd = Math.max(0.5, Math.min(2, b * 0.85));
    this.params.maxDailyLossUsd = Math.max(1, b * 0.5);
    for (const k of Object.keys(this.params.maxCategoryExposureUsd)) {
      this.params.maxCategoryExposureUsd[k as keyof typeof this.params.maxCategoryExposureUsd] =
        Math.max(1, b * 0.5);
    }
  }

  getCurrentBankroll(): number {
    return this.currentBankroll;
  }
}

export const portfolioRiskManager = new PortfolioRiskManager();

export function applyPaperBudgetToPortfolioManager(budget: PaperBudgetSettings) {
  portfolioRiskManager.applyBudgetSettings(budget);
}

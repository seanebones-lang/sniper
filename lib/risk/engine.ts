/**
 * Risk Engine - Phase 4
 * Central gatekeeper for any real (or even aggressive paper) execution.
 * 
 * All real money paths MUST go through these checks.
 */

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
}

export interface RiskContext {
  platform: string;
  marketExternalId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;           // in shares/contracts
  usdValue: number;       // price * size
}

export interface RiskLimits {
  maxUsdPerTrade: number;
  maxUsdPerMarket: number;
  maxUsdTotalExposure: number;
  dailyLossLimitUsd: number;
  maxOpenTrades: number;
}

// Default conservative limits (user can override via strategy config later)
const DEFAULT_LIMITS: RiskLimits = {
  maxUsdPerTrade: 25,
  maxUsdPerMarket: 150,
  maxUsdTotalExposure: 500,
  dailyLossLimitUsd: 100,
  maxOpenTrades: 8,
};

let dailyLossTracked = 0;
let lastLossReset = Date.now();

export function resetDailyLoss() {
  dailyLossTracked = 0;
  lastLossReset = Date.now();
}

export function recordRealizedLoss(usdLoss: number) {
  dailyLossTracked += usdLoss;
}

export function getCurrentDailyLoss(): number {
  // Auto reset after 24h
  if (Date.now() - lastLossReset > 24 * 60 * 60 * 1000) {
    resetDailyLoss();
  }
  return dailyLossTracked;
}

export function checkRisk(ctx: RiskContext, limits: Partial<RiskLimits> = {}): RiskCheckResult {
  const L = { ...DEFAULT_LIMITS, ...limits };

  // 1. Per-trade size
  if (ctx.usdValue > L.maxUsdPerTrade) {
    return { allowed: false, reason: `Trade size $${ctx.usdValue.toFixed(2)} exceeds max per trade $${L.maxUsdPerTrade}` };
  }

  // 2. Daily loss circuit breaker
  const currentDailyLoss = getCurrentDailyLoss();
  if (currentDailyLoss >= L.dailyLossLimitUsd) {
    return { allowed: false, reason: `Daily loss limit reached ($${currentDailyLoss.toFixed(2)} / $${L.dailyLossLimitUsd})` };
  }

  // TODO Phase 4+: Add real exposure tracking from DB positions + realTrades
  // For now this is a strong starting point

  return { allowed: true };
}

export const riskEngine = {
  checkRisk,
  recordRealizedLoss,
  getCurrentDailyLoss,
  resetDailyLoss,
};

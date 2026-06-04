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

import { persistSystemState } from '@/lib/monitoring/system-state';
import { db } from '@/lib/db';

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

  // Best-effort durable persistence (never block callers)
  persistSystemState('daily_loss', {
    trackedUsd: 0,
    lastResetAt: new Date().toISOString(),
  }, 'daily loss reset').catch(() => {});
}

export function recordRealizedLoss(usdLoss: number) {
  dailyLossTracked += usdLoss;

  // Best-effort durable persistence
  persistSystemState('daily_loss', {
    trackedUsd: dailyLossTracked,
    lastResetAt: new Date(lastLossReset).toISOString(),
  }, 'realized loss recorded').catch(() => {});
}

export function getCurrentDailyLoss(): number {
  // Auto reset after 24h
  if (Date.now() - lastLossReset > 24 * 60 * 60 * 1000) {
    resetDailyLoss();
  }
  return dailyLossTracked;
}

/**
 * Restore daily-loss tracking from durable state on startup so the daily-loss
 * circuit breaker is not silently zeroed by a redeploy mid-session.
 */
export function restoreDailyLoss(trackedUsd: number, lastResetAtIso?: string) {
  if (Number.isFinite(trackedUsd) && trackedUsd > 0) {
    dailyLossTracked = trackedUsd;
  }
  if (lastResetAtIso) {
    const t = Date.parse(lastResetAtIso);
    if (!Number.isNaN(t)) lastLossReset = t;
  }
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

  // Real exposure is enforced separately (async) via checkRealExposure — the
  // sync gate above stays fast for the per-order hot path.
  return { allowed: true };
}

export interface RealExposure {
  totalUsd: number;
  byMarket: Record<string, number>;
  openCount: number;
}

/**
 * Live exposure from the DB: the `positions` table (post-reconciliation truth)
 * plus still-`pending` real trades not yet reflected there. This is the real-money
 * analogue the per-trade sync gate could never see.
 */
export async function getRealExposure(): Promise<RealExposure> {
  const byMarket: Record<string, number> = {};
  let totalUsd = 0;
  let openCount = 0;

  try {
    const liveStrats = await db.query.strategies.findMany({
      where: (s, { and, eq }) => and(eq(s.isActive, true), eq(s.paperOnly, false)),
      columns: { id: true },
    });
    const ids = liveStrats.map((s) => s.id);
    if (ids.length > 0) {
      const { getRealOpenPositionsByStrategy } = await import('@/lib/execution/real-positions');
      const byStrategy = await getRealOpenPositionsByStrategy(ids);
      for (const positions of byStrategy.values()) {
        for (const p of positions) {
          const usd = p.netSize * p.avgEntryPrice;
          if (usd <= 0.001) continue;
          const key = `${p.platform}:${p.marketExternalId}`;
          byMarket[key] = (byMarket[key] || 0) + usd;
          totalUsd += usd;
          openCount++;
        }
      }
    }

    const pending = await db.query.realTrades.findMany({
      where: (t, { eq }) => eq(t.status, 'pending'),
      limit: 1000,
    });
    for (const r of pending) {
      const usd = Math.abs((parseFloat(r.size) || 0) * (parseFloat(r.price) || 0));
      if (usd <= 0) continue;
      const key = `${r.platform}:${r.marketExternalId}`;
      byMarket[key] = (byMarket[key] || 0) + usd;
      totalUsd += usd;
    }
  } catch {
    // On a read error return what we have — the portfolio manager's own caps
    // still apply, and the per-trade sync gate already ran.
  }

  return { totalUsd, byMarket, openCount };
}

/**
 * Async real-exposure gate: enforces total + per-market USD ceilings against
 * actual live holdings. Exits are never blocked here.
 */
export async function checkRealExposure(
  ctx: RiskContext & { isExit?: boolean },
  limits: Partial<RiskLimits> = {},
): Promise<RiskCheckResult> {
  if (ctx.isExit) return { allowed: true };
  const L = { ...DEFAULT_LIMITS, ...limits };
  const exposure = await getRealExposure();

  if (exposure.totalUsd + ctx.usdValue > L.maxUsdTotalExposure) {
    return {
      allowed: false,
      reason: `Real exposure $${exposure.totalUsd.toFixed(2)} + $${ctx.usdValue.toFixed(2)} exceeds total cap $${L.maxUsdTotalExposure}`,
    };
  }

  const marketKey = `${ctx.platform}:${ctx.marketExternalId}`;
  const marketExposure = exposure.byMarket[marketKey] || 0;
  if (marketExposure + ctx.usdValue > L.maxUsdPerMarket) {
    return {
      allowed: false,
      reason: `Market exposure $${marketExposure.toFixed(2)} + $${ctx.usdValue.toFixed(2)} exceeds per-market cap $${L.maxUsdPerMarket}`,
    };
  }

  return { allowed: true };
}

export const riskEngine = {
  checkRisk,
  recordRealizedLoss,
  getCurrentDailyLoss,
  resetDailyLoss,
  restoreDailyLoss,
  getRealExposure,
  checkRealExposure,
};

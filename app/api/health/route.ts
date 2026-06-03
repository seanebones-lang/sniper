import { NextResponse } from 'next/server';
import { db, auditEvents } from '@/lib/db';
import { desc } from 'drizzle-orm';
import { getStrategyPerformance } from '@/lib/research/performance';
import { getAllVariants } from '@/lib/strategies/variants';
import { executionManager } from '@/lib/execution/execution-manager';
import { riskModeManager } from '@/lib/monitoring/risk-mode';
import { getRecentRecommendations } from '@/lib/monitoring/ai-recommendations';
import { getActiveAdjustments, getAdjustmentSummary } from '@/lib/monitoring/temporary-adjustments';
import { loadRiskSnapshot, loadSystemState } from '@/lib/monitoring/system-state';
import { isRealExecutionAllowed } from '@/lib/execution/real-executor';
import { getRunnerStatus } from '@/lib/runner/engine';
const DEPLOY_MARKER = 'chunk-fix-resilient-health-v1';

// Dashboard analytics are expensive, so this endpoint is stale-while-revalidate:
// a cached payload younger than FRESH_MS is served immediately; an older one is
// served while a background recompute runs; with no cache yet we await the first
// compute up to FIRST_COMPUTE_TIMEOUT_MS and otherwise return 200 + degraded.
const FRESH_MS = 30_000;
const FIRST_COMPUTE_TIMEOUT_MS = 20_000;
let healthCache: { at: number; payload: Record<string, unknown> } | null = null;
let inflight: Promise<Record<string, unknown>> | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function refresh(base: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!inflight) {
    inflight = computeHealth(base)
      .then((payload) => {
        healthCache = { at: Date.now(), payload };
        return payload;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET() {
  const base = {
    ok: true,
    deployMarker: DEPLOY_MARKER,
    timestamp: new Date().toISOString(),
  };

  const age = healthCache ? Date.now() - healthCache.at : Infinity;

  if (healthCache && age < FRESH_MS) {
    return NextResponse.json({ ...healthCache.payload, cached: true });
  }

  if (healthCache) {
    // Stale: revalidate in the background, serve the last good payload now.
    void refresh(base).catch(() => {});
    return NextResponse.json({ ...healthCache.payload, stale: true });
  }

  // No cache yet — wait for the first compute, but never hang the endpoint.
  try {
    const payload = await withTimeout(refresh(base), FIRST_COMPUTE_TIMEOUT_MS, 'health analytics');
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json({
      ...base,
      degraded: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function computeHealth(base: Record<string, unknown>): Promise<Record<string, unknown>> {
  const performance = await getStrategyPerformance(3);
  const runnerStatus = getRunnerStatus();
  const recentAudits = await db.query.auditEvents.findMany({
    orderBy: desc(auditEvents.createdAt),
    limit: 15,
    columns: { action: true, actor: true, createdAt: true },
  });
  const variants = await getAllVariants();
  const execQuality = executionManager.getRecentExecutionQuality(30);
  const avgSlippage = executionManager.getAverageSlippage(50);
  const realExecutionAllowed = await isRealExecutionAllowed();
  const paperOnlyActive = await db.query.strategies.findMany({
    where: (s, { eq }) => eq(s.isActive, true),
    columns: { id: true, name: true, paperOnly: true },
  });

  const unhealthyMarkets = executionManager.getUnhealthyMarkets(0.5);

  const currentRiskMode = riskModeManager.getCurrentMode();

  const health = {
    timestamp: new Date().toISOString(),
    recentPerformance: performance,
    activeVariants: variants.filter(v => v.status === 'testing' || v.status === 'promoted'),
    risk: {
      mode: currentRiskMode.current,
      reason: currentRiskMode.reason,
      enteredAt: currentRiskMode.enteredAt,
      riskMultiplier: riskModeManager.getRiskMultiplier(),
      behavioralRestrictions: {
        marketLimit: currentRiskMode.current === 'EMERGENCY' ? 6 : currentRiskMode.current === 'DEFENSIVE' ? 12 : 25,
        strategyFilteringActive: currentRiskMode.current !== 'NORMAL',
      },
    },
    execution: {
      systemHealthScore: parseFloat(executionManager.getSystemHealthScore().toFixed(3)),
      recentFills: execQuality.length,
      averageSlippage: parseFloat(avgSlippage.toFixed(5)),
      unhealthyMarkets: unhealthyMarkets,
      lastFills: execQuality.slice(-5),
    },
    aiRecommendations: getRecentRecommendations(5).map((rec, idx) => ({
      ...rec,
      index: idx,
    })),

    temporaryAdjustments: {
      active: getActiveAdjustments(),
      summary: getAdjustmentSummary(),
    },

    realExecution: {
      allowed: realExecutionAllowed,
      envEnabled: process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true',
      killSwitchEnv: process.env.SNIPER_DISABLE_REAL_EXECUTION === 'true',
      activeStrategiesAllPaperOnly: paperOnlyActive.every((s) => s.paperOnly),
      activeStrategyCount: paperOnlyActive.length,
      blockers: [
        ...(process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true' ? ['SNIPER_ENABLE_REAL_EXECUTION is not true'] : []),
        ...(paperOnlyActive.every((s) => s.paperOnly) ? ['All active strategies have paperOnly=true'] : []),
        ...(process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' && !realExecutionAllowed
          ? ['Kill switch or durable disable is active']
          : []),
      ],
      totalRealFills: performance.totalRealFills,
    },

    durableState: {
      lastRiskSnapshot: await loadRiskSnapshot(),
      lastExecutionHealth: await loadSystemState<any>('execution_health_summary'),
      lastKillSwitchState: await loadSystemState<any>('kill_switch'),
    },

    summary: {
      totalActiveStrategies: performance.activeStrategies ?? 0,
      totalVariants: variants.length,
      marketsWithPoorExecution: unhealthyMarkets.length,
    },

    runner: {
      running: runnerStatus.running,
      lastRun: runnerStatus.lastRun,
      lastCycleDurationMs: runnerStatus.lastCycleDurationMs,
      signalsGenerated: runnerStatus.signalsGenerated,
      fillsExecuted: runnerStatus.fillsExecuted,
      lastCycle: runnerStatus.lastCycle,
    },

    recentAudits: recentAudits.map((a) => ({
      action: a.action,
      actor: a.actor,
      at: a.createdAt.toISOString(),
    })),
  };

  return { ...base, ...health };
}

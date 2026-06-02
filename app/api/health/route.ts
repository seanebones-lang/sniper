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
import { alerts } from '@/lib/alerts/telegram';

/**
 * Basic critical alert for real money events.
 * Logs + sends Telegram if configured.
 */
export async function sendCriticalAlert(message: string, payload?: unknown) {
  console.error(`[CRITICAL ALERT] ${message}`, payload || '');
  try {
    await alerts.error(message);
  } catch {
    console.warn(`[CRITICAL ALERT] ${message}`);
  }
}

export async function GET() {
  const performance = await getStrategyPerformance(3);
  const runnerStatus = getRunnerStatus();
  const recentAudits = await db.query.auditEvents.findMany({
    orderBy: desc(auditEvents.createdAt),
    limit: 15,
    columns: { action: true, actor: true, createdAt: true },
  });
  const variants = getAllVariants();
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

  return NextResponse.json(health);
}

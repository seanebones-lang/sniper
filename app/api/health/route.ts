import { NextResponse } from 'next/server';
import { getStrategyPerformance } from '@/lib/research/performance';
import { getAllVariants } from '@/lib/strategies/variants';
import { executionManager } from '@/lib/execution/execution-manager';
import { riskModeManager } from '@/lib/monitoring/risk-mode';
import { getRecentRecommendations } from '@/lib/monitoring/ai-recommendations';
import { getActiveAdjustments, getAdjustmentSummary } from '@/lib/monitoring/temporary-adjustments';

export async function GET() {
  const performance = await getStrategyPerformance(3);
  const variants = getAllVariants();
  const execQuality = executionManager.getRecentExecutionQuality(30);
  const avgSlippage = executionManager.getAverageSlippage(50);

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

    summary: {
      totalActiveStrategies: Object.keys(performance.byStrategy || {}).length,
      totalVariants: variants.length,
      marketsWithPoorExecution: unhealthyMarkets.length,
    },
  };

  return NextResponse.json(health);
}

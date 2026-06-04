/**
 * Strategy Allocator (Meta-Layer)
 * 
 * Dynamically allocate risk budget based on recent performance, regime, and edge quality.
 */

import { getStrategyPerformance } from '@/lib/research/performance';
import { isLiveExecutionEnabled } from '@/lib/research/strategy-attribution';
import { bankrollScaledUsd } from '@/lib/research/live-bankroll';

export interface StrategyAllocation {
  strategyId: string;
  weight: number;           // 0-1 relative allocation
  maxSizeMultiplier: number; // how much to scale the strategy's requested size
  reason: string;
}

export async function getDynamicAllocations(
  activeStrategyIds: string[],
  bankrollUsd = 25,
): Promise<Record<string, StrategyAllocation>> {
  const perf = await getStrategyPerformance(5);
  const lossCutoff = bankrollScaledUsd(bankrollUsd, -0.12);
  const winBoost = bankrollScaledUsd(bankrollUsd, 0.08);

  const allocations: Record<string, StrategyAllocation> = {};

  const totalPnl = activeStrategyIds.reduce((sum, id) => {
    const pnl = perf.byStrategy[id]?.estimatedPnlUsd ?? 0;
    return sum + Math.max(0, pnl);
  }, 0);

  const totalSignals = perf.totalSignals || 1;

  activeStrategyIds.forEach(id => {
    const stats = perf.byStrategy[id] || { signals: 0, paperFills: 0, estimatedPnlUsd: 0 };

    const pnlScore = totalPnl > 0 ? Math.max(0, stats.estimatedPnlUsd) / totalPnl : 0.5;
    const fillCount = isLiveExecutionEnabled()
      ? stats.realFills
      : stats.paperFills;
    const totalFills = isLiveExecutionEnabled()
      ? Math.max(1, perf.totalRealFills)
      : Math.max(1, perf.totalPaperFills);
    const activityScore =
      (stats.signals / totalSignals) +
      (fillCount / totalFills) * 0.4;

    let weight = Math.max(0.15, Math.min(1.0, activityScore * 0.6 + pnlScore * 0.8));
    let multiplier = 0.7 + weight * 0.8;

    let reason = 'Base allocation';

    if (stats.estimatedPnlUsd < lossCutoff) {
      weight = Math.min(weight, 0.3);
      multiplier = Math.min(multiplier, 0.45);
      reason = `Negative recent PnL (< ${(lossCutoff).toFixed(2)}) — reduced size`;
    } else if (stats.estimatedPnlUsd > winBoost) {
      multiplier = Math.min(1.35, multiplier * 1.08);
      reason = 'Positive recent PnL — slight boost';
    }

    if (stats.signals < 5) {
      weight = 0.4;
      multiplier = 0.6;
      reason = 'Low recent activity - reduced size';
    }

    allocations[id] = {
      strategyId: id,
      weight,
      maxSizeMultiplier: multiplier,
      reason,
    };
  });

  return allocations;
}

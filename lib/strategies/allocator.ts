/**
 * Strategy Allocator (Meta-Layer)
 * 
 * Dynamically allocate risk budget based on recent performance, regime, and edge quality.
 */

import { getStrategyPerformance } from '@/lib/research/performance';

export interface StrategyAllocation {
  strategyId: string;
  weight: number;           // 0-1 relative allocation
  maxSizeMultiplier: number; // how much to scale the strategy's requested size
  reason: string;
}

export async function getDynamicAllocations(activeStrategyIds: string[]): Promise<Record<string, StrategyAllocation>> {
  const perf = await getStrategyPerformance(5);

  const allocations: Record<string, StrategyAllocation> = {};

  const totalPnl = activeStrategyIds.reduce((sum, id) => {
    const pnl = perf.byStrategy[id]?.estimatedPnlUsd ?? 0;
    return sum + Math.max(0, pnl);
  }, 0);

  const totalSignals = perf.totalSignals || 1;

  activeStrategyIds.forEach(id => {
    const stats = perf.byStrategy[id] || { signals: 0, paperFills: 0, estimatedPnlUsd: 0 };

    const pnlScore = totalPnl > 0 ? Math.max(0, stats.estimatedPnlUsd) / totalPnl : 0.5;
    const activityScore =
      (stats.signals / totalSignals) +
      (stats.paperFills / Math.max(1, perf.totalPaperFills)) * 0.4;

    let weight = Math.max(0.15, Math.min(1.0, activityScore * 0.6 + pnlScore * 0.8));
    let multiplier = 0.7 + weight * 0.8;

    let reason = 'Base allocation';

    if (stats.estimatedPnlUsd < -20) {
      weight = Math.min(weight, 0.35);
      multiplier = Math.min(multiplier, 0.55);
      reason = 'Negative recent PnL — reduced size';
    } else if (stats.estimatedPnlUsd > 10) {
      multiplier = Math.min(1.5, multiplier * 1.1);
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

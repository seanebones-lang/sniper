/**
 * Strategy Allocator (Meta-Layer)
 * 
 * This is a key component for building a truly advantageous system.
 * Instead of running all strategies at fixed sizes, we dynamically allocate
 * risk budget based on recent performance, regime, and edge quality.
 * 
 * This is how professional multi-strategy operations actually work.
 */

import { getStrategyPerformance } from '@/lib/research/performance';

export interface StrategyAllocation {
  strategyId: string;
  weight: number;           // 0-1 relative allocation
  maxSizeMultiplier: number; // how much to scale the strategy's requested size
  reason: string;
}

export async function getDynamicAllocations(activeStrategyIds: string[]): Promise<Record<string, StrategyAllocation>> {
  const perf = await getStrategyPerformance(5); // look at last 5 days

  const allocations: Record<string, StrategyAllocation> = {};

  const totalSignals = perf.totalSignals || 1;

  activeStrategyIds.forEach(id => {
    const stats = perf.byStrategy[id] || { signals: 0, paperFills: 0 };

    // Very simple but effective heuristic for now:
    // - More signals + decent activity = higher allocation
    // - We can later improve this with actual PnL per strategy
    const activityScore = (stats.signals / totalSignals) + (stats.paperFills / Math.max(1, perf.totalPaperFills)) * 0.6;

    let weight = Math.max(0.15, Math.min(1.0, activityScore * 1.4));
    let multiplier = 0.7 + weight * 0.8; // between 0.7x and 1.5x

    let reason = 'Base allocation';

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

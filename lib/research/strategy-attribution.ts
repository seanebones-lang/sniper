/**
 * Unified strategy PnL windows — real money when live execution is enabled.
 */
import type { StrategyPnlStats } from '@/lib/paper/strategy-pnl';
import {
  computeStrategyPnlWindows as computePaperStrategyPnlWindows,
  statsToPerformanceWindow,
} from '@/lib/paper/strategy-pnl';

export { statsToPerformanceWindow };
export type { StrategyPnlStats };
import { computeRealStrategyPnlWindows } from '@/lib/execution/real-strategy-pnl';

export function isLiveExecutionEnabled(): boolean {
  return process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
}

export async function computeStrategyPnlWindows(
  strategyIds: string[],
  windowHours = 6,
): Promise<Map<string, StrategyPnlStats>> {
  if (isLiveExecutionEnabled()) {
    return computeRealStrategyPnlWindows(strategyIds, windowHours);
  }
  return computePaperStrategyPnlWindows(strategyIds, windowHours);
}

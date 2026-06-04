/**
 * Durable gate block counters (server-only flush).
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import { drainCycleGateCounts } from '@/lib/monitoring/live-filter-snapshot';

const STATE_KEY = 'live_gate_stats';

export type LiveGateStatsState = {
  byCode: Record<string, number>;
  lastFlushAt?: string;
  cycleBlocks?: number;
};

export async function flushLiveGateStats(): Promise<LiveGateStatsState> {
  const cycle = drainCycleGateCounts();
  const prev = (await loadSystemState<LiveGateStatsState>(STATE_KEY)) ?? { byCode: {} };
  const byCode = { ...prev.byCode };
  let cycleBlocks = 0;
  for (const [code, n] of Object.entries(cycle)) {
    byCode[code] = (byCode[code] ?? 0) + n;
    cycleBlocks += n;
  }
  const next: LiveGateStatsState = {
    byCode,
    lastFlushAt: new Date().toISOString(),
    cycleBlocks,
  };
  if (cycleBlocks > 0) {
    await persistSystemState(STATE_KEY, next, 'gate stats flush');
  }
  return next;
}

export async function getLiveGateStats(): Promise<LiveGateStatsState> {
  return (await loadSystemState<LiveGateStatsState>(STATE_KEY)) ?? { byCode: {} };
}

export { recordLiveGateBlock } from '@/lib/monitoring/live-filter-snapshot';

/**
 * In-memory gate block counters, flushed to durable system_state each runner cycle.
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';

const STATE_KEY = 'live_gate_stats';

export type LiveGateStatsState = {
  byCode: Record<string, number>;
  lastFlushAt?: string;
  cycleBlocks?: number;
};

const cycleCounts = new Map<string, number>();

export function recordLiveGateBlock(code: string): void {
  cycleCounts.set(code, (cycleCounts.get(code) ?? 0) + 1);
}

export async function flushLiveGateStats(): Promise<LiveGateStatsState> {
  const prev = (await loadSystemState<LiveGateStatsState>(STATE_KEY)) ?? { byCode: {} };
  const byCode = { ...prev.byCode };
  let cycleBlocks = 0;
  for (const [code, n] of cycleCounts) {
    byCode[code] = (byCode[code] ?? 0) + n;
    cycleBlocks += n;
  }
  cycleCounts.clear();
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

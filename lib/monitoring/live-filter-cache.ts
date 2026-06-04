/**
 * Server-only: load live intelligence from DB and prime in-memory snapshot.
 */
import {
  setRunnerLiveFilterSnapshot,
  type RunnerLiveFilterSnapshot,
} from '@/lib/monitoring/live-filter-snapshot';

export type { RunnerLiveFilterSnapshot } from '@/lib/monitoring/live-filter-snapshot';
export {
  getRunnerLiveFilterSnapshot,
  checkLiveEntryGatesSync,
  defaultLiveFilterSnapshot,
} from '@/lib/monitoring/live-filter-snapshot';

export async function primeRunnerLiveFilterSnapshot(): Promise<RunnerLiveFilterSnapshot> {
  const { getLiveFilterOverrides, loadLiveIntelligenceState } = await import(
    '@/lib/monitoring/live-intelligence'
  );
  const [filters, state] = await Promise.all([
    getLiveFilterOverrides(),
    loadLiveIntelligenceState(),
  ]);
  const maxSpreadPct = Math.max(18, filters.maxSpreadPct);
  const snap: RunnerLiveFilterSnapshot = {
    ...filters,
    maxSpreadPct,
    blockedKinds: state.blockedKinds ?? [],
    minEdgeAfterSpreadPct: state.minEdgeAfterSpreadPct ?? 6,
  };
  setRunnerLiveFilterSnapshot(snap);
  return snap;
}

export function clearRunnerLiveFilterSnapshot(): void {
  setRunnerLiveFilterSnapshot(null);
}

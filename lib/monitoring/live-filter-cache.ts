/**
 * Server-only: load live intelligence from DB and prime in-memory snapshot.
 */
import {
  setRunnerLiveFilterSnapshot,
  type RunnerLiveFilterSnapshot,
} from '@/lib/monitoring/live-filter-snapshot';
import { LIVE_QUICK_FLIP_MIN_MARKET_SCORE } from '@/lib/strategies/run-profile';

export type { RunnerLiveFilterSnapshot } from '@/lib/monitoring/live-filter-snapshot';
export {
  getRunnerLiveFilterSnapshot,
  checkLiveEntryGatesSync,
  defaultLiveFilterSnapshot,
} from '@/lib/monitoring/live-filter-snapshot';

export async function primeRunnerLiveFilterSnapshot(
  microBankrollUsd = 25,
): Promise<RunnerLiveFilterSnapshot> {
  const { getLiveFilterOverrides, loadLiveIntelligenceState } = await import(
    '@/lib/monitoring/live-intelligence'
  );
  const [filters, state] = await Promise.all([
    getLiveFilterOverrides(),
    loadLiveIntelligenceState(),
  ]);
  const maxSpreadPct = Math.max(18, filters.maxSpreadPct);
  const minMarketScore = Math.min(28, Math.max(LIVE_QUICK_FLIP_MIN_MARKET_SCORE, filters.minMarketScore));
  const snap: RunnerLiveFilterSnapshot = {
    ...filters,
    maxSpreadPct,
    minMarketScore,
    blockedKinds: state.blockedKinds ?? [],
    minEdgeAfterSpreadPct: state.minEdgeAfterSpreadPct ?? 6,
    tokenCooldownUntil: state.tokenCooldownUntil ?? {},
    entriesPaused: state.entriesPaused ?? false,
    entriesPausedReason: state.entriesPausedReason,
    microBankrollUsd,
  };
  setRunnerLiveFilterSnapshot(snap);
  return snap;
}

export function clearRunnerLiveFilterSnapshot(): void {
  setRunnerLiveFilterSnapshot(null);
}

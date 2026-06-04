/**
 * Persist closed live round-trips for Grok / dashboard attribution.
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import type { RealRoundTrip } from '@/lib/execution/real-strategy-pnl';

const STATE_KEY = 'live_trade_outcomes';
const MAX_OUTCOMES = 150;

export type StoredLiveOutcome = {
  closedAt: string;
  marketExternalId: string;
  kind: string;
  pnlUsd: number;
  holdSec: number;
  avgEntry: number;
  avgExit: number;
  strategyId: string | null;
};

export async function appendLiveTradeOutcome(trip: RealRoundTrip): Promise<void> {
  const prev =
    (await loadSystemState<{ outcomes?: StoredLiveOutcome[] }>(STATE_KEY)) ?? {};
  const outcomes = prev.outcomes ?? [];
  outcomes.push({
    closedAt: trip.closedAt.toISOString(),
    marketExternalId: trip.marketExternalId,
    kind: trip.kind,
    pnlUsd: trip.pnlUsd,
    holdSec: Math.round(trip.holdMs / 1000),
    avgEntry: trip.avgEntry,
    avgExit: trip.avgExit,
    strategyId: trip.strategyId,
  });
  const trimmed = outcomes.slice(-MAX_OUTCOMES);
  await persistSystemState(STATE_KEY, { outcomes: trimmed }, 'round trip closed');
}

export async function getRecentLiveOutcomes(limit = 20): Promise<StoredLiveOutcome[]> {
  const prev =
    (await loadSystemState<{ outcomes?: StoredLiveOutcome[] }>(STATE_KEY)) ?? {};
  return (prev.outcomes ?? []).slice(-limit).reverse();
}

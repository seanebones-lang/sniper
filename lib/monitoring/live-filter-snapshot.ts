/**
 * In-memory live filter snapshot (no DB). Runner sets this each cycle; strategies read it.
 */
import type { FastMovingKind } from '@/lib/markets/fast-moving';
import { assessFastMovingMarket } from '@/lib/markets/fast-moving';
import type { Market, OrderBook } from '@/lib/types';
import {
  LIVE_QUICK_FLIP_MAX_SPREAD_PCT,
  LIVE_QUICK_FLIP_MIN_MARKET_SCORE,
} from '@/lib/strategies/run-profile';

export type RunnerLiveFilterSnapshot = {
  minMarketScore: number;
  maxSpreadPct: number;
  allowedKinds: FastMovingKind[] | null;
  blockedKinds: FastMovingKind[];
  minEdgeAfterSpreadPct: number;
  tokenCooldownMs: number;
};

let snapshot: RunnerLiveFilterSnapshot | null = null;

export function setRunnerLiveFilterSnapshot(next: RunnerLiveFilterSnapshot | null): void {
  snapshot = next;
}

export function getRunnerLiveFilterSnapshot(): RunnerLiveFilterSnapshot | null {
  return snapshot;
}

export function defaultLiveFilterSnapshot(): RunnerLiveFilterSnapshot {
  return {
    minMarketScore: LIVE_QUICK_FLIP_MIN_MARKET_SCORE,
    maxSpreadPct: LIVE_QUICK_FLIP_MAX_SPREAD_PCT,
    allowedKinds: ['short-crypto'],
    blockedKinds: [],
    minEdgeAfterSpreadPct: 6,
    tokenCooldownMs: 30 * 60 * 1000,
  };
}

function kindBlocked(kind: FastMovingKind, snap: RunnerLiveFilterSnapshot): boolean {
  if (snap.blockedKinds.includes(kind)) return true;
  if (snap.allowedKinds && snap.allowedKinds.length > 0) {
    return !snap.allowedKinds.includes(kind);
  }
  return false;
}

export function checkLiveEntryGatesSync(
  market: Market,
  book: OrderBook | null | undefined,
  ask: number,
  bid: number,
): boolean {
  const snap = snapshot ?? defaultLiveFilterSnapshot();
  const assessment = assessFastMovingMarket(market);
  if (assessment.kind === 'none') return true;
  if (kindBlocked(assessment.kind, snap)) return true;
  if (assessment.score < snap.minMarketScore) return true;
  const mid = book?.mid ?? (ask + bid) / 2;
  const spread = book?.spread ?? ask - bid;
  if (mid > 0) {
    const spreadPct = (spread / mid) * 100;
    if (spreadPct > snap.maxSpreadPct) return true;
  }
  return false;
}

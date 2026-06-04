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

function isTokenOnCooldownFromMap(
  tokenId: string,
  tokenCooldownUntil: Record<string, string> | undefined,
): boolean {
  const until = tokenCooldownUntil?.[tokenId];
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

function microKindHardBlocked(
  kind: FastMovingKind,
  bankrollUsd: number,
  blockedKinds: FastMovingKind[],
): boolean {
  if (bankrollUsd <= 0 || bankrollUsd > 25) return false;
  return kind === 'short-crypto' && blockedKinds.includes('short-crypto');
}

export type RunnerLiveFilterSnapshot = {
  minMarketScore: number;
  maxSpreadPct: number;
  allowedKinds: FastMovingKind[] | null;
  blockedKinds: FastMovingKind[];
  minEdgeAfterSpreadPct: number;
  tokenCooldownMs: number;
  tokenCooldownUntil: Record<string, string>;
  entriesPaused: boolean;
  entriesPausedReason?: string;
  microBankrollUsd: number;
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
    tokenCooldownMs: 45 * 60 * 1000,
    tokenCooldownUntil: {},
    entriesPaused: false,
    microBankrollUsd: 25,
  };
}

function kindBlocked(kind: FastMovingKind, snap: RunnerLiveFilterSnapshot): boolean {
  if (snap.blockedKinds.includes(kind)) return true;
  if (snap.allowedKinds && snap.allowedKinds.length > 0) {
    return !snap.allowedKinds.includes(kind);
  }
  return false;
}

const cycleGateCounts = new Map<string, number>();

export function recordLiveGateBlock(code: string): void {
  cycleGateCounts.set(code, (cycleGateCounts.get(code) ?? 0) + 1);
}

export function drainCycleGateCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, n] of cycleGateCounts) out[code] = n;
  cycleGateCounts.clear();
  return out;
}

export function checkLiveEntryGatesSync(
  market: Market,
  book: OrderBook | null | undefined,
  ask: number,
  bid: number,
): boolean {
  const snap = snapshot;
  if (!snap) return false;
  if (snap.entriesPaused) {
    recordLiveGateBlock('entries_paused');
    return true;
  }
  if (isTokenOnCooldownFromMap(market.externalId, snap.tokenCooldownUntil)) {
    recordLiveGateBlock('token_cooldown');
    return true;
  }
  const assessment = assessFastMovingMarket(market);
  if (assessment.kind === 'none') {
    recordLiveGateBlock('not_fast_moving');
    return true;
  }
  if (microKindHardBlocked(assessment.kind, snap.microBankrollUsd, snap.blockedKinds)) {
    recordLiveGateBlock('micro_kind_blocked');
    return true;
  }
  if (kindBlocked(assessment.kind, snap)) {
    recordLiveGateBlock('kind_blocked');
    return true;
  }
  if (assessment.score < snap.minMarketScore) {
    recordLiveGateBlock('low_market_score');
    return true;
  }
  const mid = book?.mid ?? (ask + bid) / 2;
  const spread = book?.spread ?? ask - bid;
  if (mid > 0) {
    const spreadPct = (spread / mid) * 100;
    if (spreadPct > snap.maxSpreadPct) {
      recordLiveGateBlock('spread_too_wide');
      return true;
    }
  }
  return false;
}

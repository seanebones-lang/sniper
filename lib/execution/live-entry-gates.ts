/**
 * Pre-trade gates for live autonomous entries (evaluate + order time).
 */
import type { Market, OrderBook } from '@/lib/types';
import type { ResolvedStrategyConfig } from '@/lib/strategies/run-profile';
import { assessFastMovingMarket } from '@/lib/markets/fast-moving';
import type { FastMovingKind } from '@/lib/markets/fast-moving';
import {
  getLiveFilterOverrides,
  isKindBlockedByIntelligence,
  isTokenOnCooldown,
  type LiveFilterOverrides,
} from '@/lib/monitoring/live-intelligence';
import { getRunnerLiveFilterSnapshot } from '@/lib/monitoring/live-filter-snapshot';
import { analyzeLiveRoundTrips } from '@/lib/execution/real-strategy-pnl';
import { isMarketPaused } from '@/lib/monitoring/temporary-adjustments';
import { executionManager } from '@/lib/execution/execution-manager';
import { recordLiveGateBlock } from '@/lib/monitoring/live-filter-snapshot';

export type LiveEntryGateInput = {
  market: Market;
  book: OrderBook | null | undefined;
  config: ResolvedStrategyConfig;
  ask: number;
  bid: number;
  stakeUsd: number;
  targetMultiple: number;
};

export type LiveEntryGateResult =
  | { allowed: true }
  | { allowed: false; reason: string; code: string };

const SPORTS_KINDS: FastMovingKind[] = ['sports-live', 'sports'];

export const LIVE_MIN_EDGE_AFTER_SPREAD = 0.06;

let cachedSportsBlock: { at: number; block: boolean } | null = null;
const SPORTS_CACHE_MS = 5 * 60 * 1000;

async function resolveFilters(): Promise<LiveFilterOverrides> {
  const snap = getRunnerLiveFilterSnapshot();
  if (snap) return snap;
  return getLiveFilterOverrides();
}

async function shouldBlockSportsLive(): Promise<boolean> {
  const now = Date.now();
  if (cachedSportsBlock && now - cachedSportsBlock.at < SPORTS_CACHE_MS) {
    return cachedSportsBlock.block;
  }
  const attr = await analyzeLiveRoundTrips(24);
  const block =
    attr.sportsLiveWinRatePct != null &&
    attr.roundTrips >= 5 &&
    attr.sportsLiveWinRatePct < 25;
  cachedSportsBlock = { at: now, block };
  return block;
}

function deny(code: string, reason: string): LiveEntryGateResult {
  recordLiveGateBlock(code);
  return { allowed: false, reason, code };
}

export async function checkLiveEntryGates(
  input: LiveEntryGateInput,
): Promise<LiveEntryGateResult> {
  const { market, book, config, ask, bid, stakeUsd, targetMultiple } = input;

  if (isMarketPaused(market.externalId)) {
    return deny('market_paused', 'Market paused by intelligence layer');
  }

  if (await isTokenOnCooldown(market.externalId)) {
    return deny('token_cooldown', 'Token cooldown after recent losing exit');
  }

  const filters = await resolveFilters();
  const assessment = assessFastMovingMarket(market);

  if (assessment.kind === 'none') {
    return deny('not_fast_moving', 'Market not classified as fast-moving');
  }

  const kind = assessment.kind;

  if (isKindBlockedByIntelligence(kind, filters)) {
    return deny(
      'kind_blocked',
      `Market kind "${kind}" blocked by live intelligence`,
    );
  }

  if (SPORTS_KINDS.includes(kind) && (await shouldBlockSportsLive())) {
    return deny('sports_win_rate', 'Sports live entries blocked — 24h win rate below 25%');
  }

  if (assessment.score < filters.minMarketScore) {
    return deny(
      'low_market_score',
      `Market score ${assessment.score} < min ${filters.minMarketScore}`,
    );
  }

  const execHealth = executionManager.getMarketHealth(market.externalId);
  if (execHealth.recentFills >= 2 && execHealth.healthScore < 0.35) {
    return deny(
      'adverse_execution',
      `Poor execution health (${(execHealth.healthScore * 100).toFixed(0)}%) on this market`,
    );
  }

  const mid = book?.mid ?? (ask + bid) / 2;
  const spread = book?.spread ?? ask - bid;
  if (mid > 0) {
    const spreadPct = (spread / mid) * 100;
    if (spreadPct > filters.maxSpreadPct) {
      return deny(
        'spread_too_wide',
        `Spread ${spreadPct.toFixed(1)}% > max ${filters.maxSpreadPct}%`,
      );
    }

    const grossEdge = (ask * targetMultiple - ask) / ask;
    const edgeAfterSpread = grossEdge - spreadPct / 100;
    const minEdgePct = filters.minEdgeAfterSpreadPct ?? config.minEdgeAfterSpreadPct ?? 6;
    const minEdge = minEdgePct / 100;
    if (edgeAfterSpread < minEdge) {
      return deny(
        'insufficient_edge',
        `Edge after spread ${(edgeAfterSpread * 100).toFixed(1)}% < min ${minEdgePct}%`,
      );
    }
  }

  const bidSize = book?.bids?.[0]?.size ?? 0;
  const sharesNeeded = Math.max(1, Math.ceil(stakeUsd / ask));
  if (bid <= 0 || bidSize < sharesNeeded) {
    return deny('no_bid_depth', 'Insufficient bid depth for exit');
  }

  const bidNotional = bid * bidSize;
  if (bidNotional < stakeUsd * 1.5) {
    return deny('thin_bid', `Bid notional $${bidNotional.toFixed(2)} < 1.5× stake`);
  }

  return { allowed: true };
}

export { checkLiveEntryGatesSync } from '@/lib/monitoring/live-filter-snapshot';

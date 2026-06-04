/**
 * Live autonomous trading intelligence: filters, learning state, safe Grok apply.
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import { applyTemporaryAdjustment } from '@/lib/monitoring/temporary-adjustments';
import { db, auditEvents } from '@/lib/db';
import type { FastMovingKind } from '@/lib/markets/fast-moving';
import {
  LIVE_QUICK_FLIP_MAX_SPREAD_PCT,
  LIVE_QUICK_FLIP_MIN_MARKET_SCORE,
} from '@/lib/strategies/run-profile';
import { bankrollScaledUsd } from '@/lib/research/live-bankroll';
import { alerts } from '@/lib/alerts/telegram';

const STATE_KEY = 'live_intelligence';

export type LiveIntelligenceState = {
  minMarketScore?: number;
  maxSpreadPct?: number;
  minEdgeAfterSpreadPct?: number;
  allowedKinds?: FastMovingKind[] | null;
  /** Kinds auto-blocked by learning loop (24h negative expectancy) */
  blockedKinds?: FastMovingKind[];
  /** When true, runner may exit but must not open new live entries */
  entriesPaused?: boolean;
  entriesPausedReason?: string;
  tokenCooldownMs?: number;
  tokenCooldownUntil?: Record<string, string>;
  lastGrokApplyAt?: string;
  lastLearningAt?: string;
  lastLearningSummary?: string;
};

export type LiveFilterOverrides = {
  minMarketScore: number;
  maxSpreadPct: number;
  allowedKinds: FastMovingKind[] | null;
  blockedKinds: FastMovingKind[];
  minEdgeAfterSpreadPct: number;
  tokenCooldownMs: number;
};

const DEFAULTS: LiveFilterOverrides = {
  minMarketScore: LIVE_QUICK_FLIP_MIN_MARKET_SCORE,
  maxSpreadPct: LIVE_QUICK_FLIP_MAX_SPREAD_PCT,
  allowedKinds: ['short-crypto'],
  blockedKinds: [],
  minEdgeAfterSpreadPct: 6,
  tokenCooldownMs: 45 * 60 * 1000,
};

export async function loadLiveIntelligenceState(): Promise<LiveIntelligenceState> {
  return (await loadSystemState<LiveIntelligenceState>(STATE_KEY)) ?? {};
}

export async function saveLiveIntelligenceState(
  patch: Partial<LiveIntelligenceState>,
  reason: string,
): Promise<LiveIntelligenceState> {
  const prev = await loadLiveIntelligenceState();
  const next = { ...prev, ...patch };
  await persistSystemState(STATE_KEY, next, reason);
  return next;
}

export async function getLiveFilterOverrides(): Promise<LiveFilterOverrides> {
  const s = await loadLiveIntelligenceState();
  const blockedKinds = s.blockedKinds ?? DEFAULTS.blockedKinds;
  const allowedKinds =
    s.allowedKinds === undefined ? DEFAULTS.allowedKinds : s.allowedKinds;
  const rawScore = s.minMarketScore ?? DEFAULTS.minMarketScore;
  const minMarketScore = Math.min(28, Math.max(LIVE_QUICK_FLIP_MIN_MARKET_SCORE, rawScore));
  return {
    minMarketScore,
    maxSpreadPct: s.maxSpreadPct ?? DEFAULTS.maxSpreadPct,
    allowedKinds,
    blockedKinds,
    minEdgeAfterSpreadPct: s.minEdgeAfterSpreadPct ?? DEFAULTS.minEdgeAfterSpreadPct,
    tokenCooldownMs: s.tokenCooldownMs ?? DEFAULTS.tokenCooldownMs,
  };
}

export function isKindBlockedByIntelligence(
  kind: FastMovingKind,
  filters: Pick<LiveFilterOverrides, 'allowedKinds' | 'blockedKinds'>,
): boolean {
  if (filters.blockedKinds.includes(kind)) return true;
  if (filters.allowedKinds && filters.allowedKinds.length > 0) {
    return !filters.allowedKinds.includes(kind);
  }
  return false;
}

export async function recordTokenTripCooldown(
  tokenId: string,
  cooldownMs?: number,
  reason = 'trip cooldown',
): Promise<void> {
  const s = await loadLiveIntelligenceState();
  const ms = cooldownMs ?? s.tokenCooldownMs ?? DEFAULTS.tokenCooldownMs;
  const until = new Date(Date.now() + ms).toISOString();
  const tokenCooldownUntil = { ...(s.tokenCooldownUntil ?? {}), [tokenId]: until };
  const pruned = pruneCooldowns(tokenCooldownUntil);
  await saveLiveIntelligenceState({ tokenCooldownUntil: pruned }, reason);
}

/** @deprecated use recordTokenTripCooldown */
export async function recordTokenLossCooldown(
  tokenId: string,
  cooldownMs?: number,
): Promise<void> {
  await recordTokenTripCooldown(tokenId, cooldownMs, 'loss cooldown');
}

export function isTokenOnCooldownFromMap(
  tokenId: string,
  tokenCooldownUntil: Record<string, string> | undefined,
): boolean {
  const until = tokenCooldownUntil?.[tokenId];
  if (!until) return false;
  return new Date(until).getTime() > Date.now();
}

export async function isTokenOnCooldown(tokenId: string): Promise<boolean> {
  const s = await loadLiveIntelligenceState();
  const until = s.tokenCooldownUntil?.[tokenId];
  if (!until) return false;
  if (new Date(until).getTime() <= Date.now()) return false;
  return true;
}

export async function clearTokenCooldown(tokenId: string): Promise<void> {
  const s = await loadLiveIntelligenceState();
  const tokenCooldownUntil = { ...(s.tokenCooldownUntil ?? {}) };
  delete tokenCooldownUntil[tokenId];
  await saveLiveIntelligenceState({ tokenCooldownUntil }, 'manual cooldown clear');
}

function pruneCooldowns(map: Record<string, string>): Record<string, string> {
  const now = Date.now();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (new Date(v).getTime() > now) out[k] = v;
  }
  const keys = Object.keys(out);
  if (keys.length > 80) {
    const sorted = keys.sort((a, b) => new Date(out[a]).getTime() - new Date(out[b]).getTime());
    for (const k of sorted.slice(-80)) out[k] = map[k];
  }
  return out;
}

type ParsedAction = {
  action: string;
  target: string;
  value?: string | number;
  reason: string;
};

/** Safe live auto-apply: filter tuning only — never pause strategy or cancel all orders. */
export async function applySafeGrokActionsForLive(
  actions: ParsedAction[],
  context: { systemHealth: number; recentPnlUsd: number; bankrollUsd: number },
): Promise<string[]> {
  const applied: string[] = [];
  const patches: Partial<LiveIntelligenceState> = {};
  const lossCutoff = bankrollScaledUsd(context.bankrollUsd, -0.08);

  for (const action of actions) {
    const a = action.action.toLowerCase().replace(/_/g, ' ');
    const value = typeof action.value === 'number' ? action.value : parseFloat(String(action.value ?? ''));

    if (a.includes('pause') && a.includes('strategy')) continue;
    if (a.includes('cancel') && (a.includes('market') || action.target === 'global')) continue;

    if (a.includes('defensive') || (a.includes('reduce') && a.includes('risk'))) {
      if (context.systemHealth < 0.55 || context.recentPnlUsd < lossCutoff) {
        applyTemporaryAdjustment({
          type: 'global_risk_multiplier',
          value: Math.max(0.35, Number.isFinite(value) ? value : 0.5),
          reason: `Grok live-safe: ${action.reason}`,
          expiresAfterRuns: 20,
          source: 'grok_auto',
        });
        applied.push(`global_risk_multiplier=${Math.max(0.35, value || 0.5)}`);
      }
    }

    if (a.includes('reduce') && (a.includes('allocation') || a.includes('size'))) {
      const strategyId = action.target.match(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      )?.[0];
      if (strategyId) {
        const down = Math.max(0.25, Math.min(1, Number.isFinite(value) ? value : 0.6));
        applyTemporaryAdjustment({
          type: 'strategy_downweight',
          target: strategyId,
          value: down,
          reason: `Grok live-safe: ${action.reason}`,
          expiresAfterRuns: 30,
          source: 'grok_auto',
        });
        applied.push(`strategy_downweight=${down}`);
      }
    }

    if (a.includes('edge') && Number.isFinite(value) && value > 0 && value <= 30) {
      patches.minEdgeAfterSpreadPct = Math.min(15, Math.max(4, value));
      applied.push(`minEdgeAfterSpreadPct=${patches.minEdgeAfterSpreadPct}`);
    }

    if (a.includes('other') || a.includes('filter') || a.includes('spread')) {
      if (Number.isFinite(value) && value > 0 && value <= 100) {
        patches.maxSpreadPct = Math.min(35, Math.max(12, value));
        applied.push(`maxSpreadPct=${patches.maxSpreadPct}`);
      }
    }

    if (a.includes('crypto') || a.includes('short-crypto')) {
      patches.allowedKinds = ['short-crypto'];
      applied.push('allowedKinds=short-crypto');
    }

    if (context.recentPnlUsd < bankrollScaledUsd(context.bankrollUsd, -0.08)) {
      patches.minMarketScore = Math.min(45, (patches.minMarketScore ?? DEFAULTS.minMarketScore) + 4);
      applied.push(`minMarketScore=${patches.minMarketScore}`);
    }
  }

  if (Object.keys(patches).length > 0) {
    patches.lastGrokApplyAt = new Date().toISOString();
    await saveLiveIntelligenceState(patches, 'Grok safe live apply');
    try {
      await db.insert(auditEvents).values({
        actor: 'live-intelligence',
        action: 'grok_live_safe_applied',
        payload: { applied, patches },
      });
      void alerts.error(`Live Grok filters updated: ${applied.join(', ')}`);
    } catch {
      // best effort
    }
  }

  return applied;
}

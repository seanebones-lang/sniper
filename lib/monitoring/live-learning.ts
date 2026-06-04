/**
 * Autonomous live learning: closed-trip outcomes → filter tightening (no manual Grok required).
 */
import type { FastMovingKind } from '@/lib/markets/fast-moving';
import { analyzeLiveRoundTrips } from '@/lib/execution/real-strategy-pnl';
import { getRecentLiveOutcomes } from '@/lib/monitoring/live-trade-outcomes';
import {
  loadLiveIntelligenceState,
  saveLiveIntelligenceState,
  type LiveIntelligenceState,
} from '@/lib/monitoring/live-intelligence';
import { bankrollScaledUsd } from '@/lib/research/live-bankroll';
import { db, auditEvents } from '@/lib/db';

export type LiveLearningResult = {
  patched: boolean;
  blockedKinds: FastMovingKind[];
  minMarketScore?: number;
  maxSpreadPct?: number;
  reasons: string[];
};

const MIN_KIND_TRIPS = 3;
const KIND_LOSS_BLOCK_PNL = -0.35;
const KIND_MAX_WIN_RATE = 0.28;

/**
 * Run after closed trips / each N runner cycles when live.
 */
export async function runLiveLearningCycle(bankrollUsd: number): Promise<LiveLearningResult> {
  const [attr, outcomes, prev] = await Promise.all([
    analyzeLiveRoundTrips(24),
    getRecentLiveOutcomes(40),
    loadLiveIntelligenceState(),
  ]);

  const reasons: string[] = [];
  const patches: Partial<LiveIntelligenceState> = {};
  const blocked = new Set<FastMovingKind>(prev.blockedKinds ?? []);

  if ((prev.maxSpreadPct ?? 25) < 18) {
    patches.maxSpreadPct = 18;
    reasons.push('floor maxSpreadPct at 18 (was over-tightened)');
  }

  for (const [kind, k] of Object.entries(attr.byKind)) {
    if (k.trips < MIN_KIND_TRIPS) continue;
    const winRate = k.trips > 0 ? k.wins / k.trips : 0;
    if (k.pnlUsd <= KIND_LOSS_BLOCK_PNL && winRate < KIND_MAX_WIN_RATE) {
      blocked.add(kind as FastMovingKind);
      reasons.push(`block kind ${kind}: ${k.trips} trips, $${k.pnlUsd.toFixed(2)}, ${(winRate * 100).toFixed(0)}% WR`);
    } else if (k.pnlUsd > 0.2 && winRate >= 0.4) {
      blocked.delete(kind as FastMovingKind);
      reasons.push(`unblock kind ${kind}: positive 24h edge`);
    }
  }

  const lossStreak = outcomes.filter((o) => o.pnlUsd < -0.03).length;
  const totalLossThreshold = bankrollScaledUsd(bankrollUsd, -0.12);
  if (attr.totalPnlUsd < totalLossThreshold || lossStreak >= 4) {
    const nextScore = Math.min(45, (prev.minMarketScore ?? 22) + 3);
    patches.minMarketScore = nextScore;
    reasons.push(`tighten minMarketScore → ${nextScore} (24h PnL $${attr.totalPnlUsd.toFixed(2)})`);
  }

  if (attr.roundTrips >= 5 && attr.winRatePct < 20) {
    patches.maxSpreadPct = Math.max(18, Math.min(22, (prev.maxSpreadPct ?? 25) - 2));
    reasons.push(`tighten maxSpreadPct → ${patches.maxSpreadPct}`);
  }

  if (blocked.size > 0) {
    patches.blockedKinds = [...blocked];
  }

  if (Object.keys(patches).length === 0) {
    return { patched: false, blockedKinds: [...blocked], reasons };
  }

  patches.lastLearningAt = new Date().toISOString();
  await saveLiveIntelligenceState(patches, 'autonomous learning cycle');
  try {
    await db.insert(auditEvents).values({
      actor: 'live-learning',
      action: 'live_learning_applied',
      payload: { patches, reasons, bankrollUsd, attr: { roundTrips: attr.roundTrips, totalPnlUsd: attr.totalPnlUsd } },
    });
  } catch {
    // best effort
  }

  return {
    patched: true,
    blockedKinds: [...blocked],
    minMarketScore: patches.minMarketScore,
    maxSpreadPct: patches.maxSpreadPct,
    reasons,
  };
}

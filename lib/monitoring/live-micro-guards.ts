/**
 * Hard survival guards for micro live accounts (~$25 and below).
 */
import { analyzeLiveRoundTrips } from '@/lib/execution/real-strategy-pnl';
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import {
  loadLiveIntelligenceState,
  saveLiveIntelligenceState,
} from '@/lib/monitoring/live-intelligence';
import type { FastMovingKind } from '@/lib/markets/fast-moving';

/** No new BUYs when free cash is below this (exits still run). */
export const LIVE_MICRO_MIN_CASH_USD = 5;

/** Accounts at or below this equity use micro guards. */
export const LIVE_MICRO_EQUITY_CEILING_USD = 25;

/** Halt new entries after this fraction of session-start bankroll is lost in 24h. */
export const LIVE_MICRO_DAILY_LOSS_PCT = 0.15;

/** Cooldown after any closed round-trip on a token (not just large losses). */
export const LIVE_MICRO_TOKEN_COOLDOWN_MS = 45 * 60 * 1000;

const SESSION_KEY = 'live_session_bankroll' satisfies import('@/lib/monitoring/system-state').SystemStateKey;

export type LiveMicroGuardVerdict = {
  entriesAllowed: boolean;
  code: string | null;
  reason: string | null;
  dailyLossHalt: boolean;
  cashFloor: boolean;
  sessionStartBankrollUsd: number;
};

type SessionBankrollRow = {
  startBankrollUsd: number;
  dayUtc: string;
  updatedAt: string;
};

export function isMicroLiveAccount(bankrollUsd: number): boolean {
  return bankrollUsd > 0 && bankrollUsd <= LIVE_MICRO_EQUITY_CEILING_USD;
}

export async function touchLiveSessionBankroll(currentBankrollUsd: number): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const prev = await loadSystemState<SessionBankrollRow>(SESSION_KEY);
  const refilled =
    prev != null &&
    currentBankrollUsd > prev.startBankrollUsd * 1.15 + 0.5;
  const newDay = !prev || prev.dayUtc !== today;

  if (!prev || newDay || refilled) {
    const row: SessionBankrollRow = {
      startBankrollUsd: Math.max(0.01, currentBankrollUsd),
      dayUtc: today,
      updatedAt: new Date().toISOString(),
    };
    await persistSystemState(
      SESSION_KEY,
      row,
      refilled ? 'session bankroll reset (refill)' : 'session bankroll touch',
    );
    return row.startBankrollUsd;
  }

  return prev.startBankrollUsd;
}

export async function evaluateLiveMicroGuards(
  cashBalanceUsd: number | null,
  bankrollUsd: number,
): Promise<LiveMicroGuardVerdict> {
  const sessionStart = await touchLiveSessionBankroll(bankrollUsd);

  if (!isMicroLiveAccount(bankrollUsd)) {
    return {
      entriesAllowed: true,
      code: null,
      reason: null,
      dailyLossHalt: false,
      cashFloor: false,
      sessionStartBankrollUsd: sessionStart,
    };
  }

  const intel = await loadLiveIntelligenceState();
  if (intel.entriesPaused) {
    return {
      entriesAllowed: false,
      code: 'entries_paused',
      reason: intel.entriesPausedReason ?? 'Live entries paused by intelligence',
      dailyLossHalt: true,
      cashFloor: false,
      sessionStartBankrollUsd: sessionStart,
    };
  }

  if (cashBalanceUsd != null && cashBalanceUsd < LIVE_MICRO_MIN_CASH_USD) {
    return {
      entriesAllowed: false,
      code: 'micro_cash_floor',
      reason: `Cash $${cashBalanceUsd.toFixed(2)} below $${LIVE_MICRO_MIN_CASH_USD} floor — exit-only`,
      dailyLossHalt: false,
      cashFloor: true,
      sessionStartBankrollUsd: sessionStart,
    };
  }

  const attr = await analyzeLiveRoundTrips(24);
  const lossLimit = -sessionStart * LIVE_MICRO_DAILY_LOSS_PCT;
  if (attr.totalPnlUsd <= lossLimit && attr.roundTrips >= 2) {
    const reason = `24h PnL $${attr.totalPnlUsd.toFixed(2)} breached −${(LIVE_MICRO_DAILY_LOSS_PCT * 100).toFixed(0)}% of session start $${sessionStart.toFixed(2)}`;
    // Avoid re-writing pause every runner cycle once already halted.
    if (!intel.entriesPaused) {
      await saveLiveIntelligenceState(
        { entriesPaused: true, entriesPausedReason: reason },
        'micro daily loss halt',
      );
    }
    return {
      entriesAllowed: false,
      code: 'micro_daily_loss_halt',
      reason,
      dailyLossHalt: true,
      cashFloor: false,
      sessionStartBankrollUsd: sessionStart,
    };
  }

  return {
    entriesAllowed: true,
    code: null,
    reason: null,
    dailyLossHalt: false,
    cashFloor: false,
    sessionStartBankrollUsd: sessionStart,
  };
}

/** Block short-crypto on micro until learning explicitly unblocks it. */
export function isMicroKindHardBlocked(
  kind: FastMovingKind,
  bankrollUsd: number,
  blockedKinds: FastMovingKind[],
): boolean {
  if (!isMicroLiveAccount(bankrollUsd)) return false;
  if (kind === 'short-crypto' && blockedKinds.includes('short-crypto')) return true;
  return false;
}

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
export const LIVE_MICRO_MIN_CASH_USD = 1;

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
  zenStartedAt?: string;
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
      zenStartedAt: refilled ? new Date().toISOString() : prev?.zenStartedAt,
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

/**
 * Stable marker embedded in the daily-loss halt reason. The halt is a rolling 24h
 * breaker that this guard both sets and clears, so the marker lets us tell our own
 * pause apart from kind-block / manual pauses that must stay latched until their
 * owner lifts them. `live-ops-monitor.ts` keys off the same substring.
 */
export const MICRO_DAILY_LOSS_HALT_MARKER = 'breached −';

function formatMicroDailyLossHaltReason(totalPnlUsd: number, sessionStartUsd: number): string {
  return `24h PnL $${totalPnlUsd.toFixed(2)} ${MICRO_DAILY_LOSS_HALT_MARKER}${(LIVE_MICRO_DAILY_LOSS_PCT * 100).toFixed(0)}% of session start $${sessionStartUsd.toFixed(2)}`;
}

/** True when an `entriesPaused` reason was set by this guard's daily-loss halt. */
export function isMicroDailyLossHaltReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.includes(MICRO_DAILY_LOSS_HALT_MARKER);
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

  // The daily-loss halt below is a rolling 24h breaker, not a permanent stop.
  // Recognize a pause WE set so we can re-evaluate and lift it once the window
  // recovers. Pauses from other sources (kind allow-list fully blocked, manual
  // review) stay latched — only their owner may clear them.
  const selfManagedDailyLossPause =
    intel.entriesPaused === true && isMicroDailyLossHaltReason(intel.entriesPausedReason);

  if (intel.entriesPaused && !selfManagedDailyLossPause) {
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
  const unrestrictedKinds = intel.allowedKinds === null;
  const dailyLossBreached =
    !unrestrictedKinds && attr.totalPnlUsd <= lossLimit && attr.roundTrips >= 2;

  if (dailyLossBreached) {
    const reason = formatMicroDailyLossHaltReason(attr.totalPnlUsd, sessionStart);
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

  // Rolling window recovered — lift a stale daily-loss halt WE previously set so
  // the runner resumes live entries without manual intervention.
  if (selfManagedDailyLossPause) {
    await saveLiveIntelligenceState(
      { entriesPaused: false, entriesPausedReason: undefined },
      'micro daily-loss halt auto-cleared (24h window recovered)',
    );
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

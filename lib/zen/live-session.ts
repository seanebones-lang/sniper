/**
 * Live zen / runner session boundary — equity curve and stats start fresh from here.
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';

const SESSION_KEY = 'live_session_bankroll' satisfies import('@/lib/monitoring/system-state').SystemStateKey;

export type LiveSessionBankrollRow = {
  startBankrollUsd: number;
  dayUtc: string;
  updatedAt: string;
  /** Zen curve + live runner fill stats only count activity after this time. */
  zenStartedAt?: string;
};

export async function getLiveZenSessionStartedAt(): Promise<Date | null> {
  const row = await loadSystemState<LiveSessionBankrollRow>(SESSION_KEY);
  if (!row?.zenStartedAt) return null;
  const d = new Date(row.zenStartedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function getLiveSessionStartBankrollUsd(): Promise<number | null> {
  const row = await loadSystemState<LiveSessionBankrollRow>(SESSION_KEY);
  if (row?.startBankrollUsd != null && row.startBankrollUsd > 0) return row.startBankrollUsd;
  return null;
}

/** Reset zen baseline + micro session bankroll to current CLOB cash (does not delete trades). */
export async function resetLiveZenSession(clobCashUsd: number, reason = 'manual fresh start'): Promise<LiveSessionBankrollRow> {
  const now = new Date();
  const row: LiveSessionBankrollRow = {
    startBankrollUsd: Math.max(0.01, clobCashUsd),
    dayUtc: now.toISOString().slice(0, 10),
    zenStartedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await persistSystemState(SESSION_KEY, row, reason);
  return row;
}

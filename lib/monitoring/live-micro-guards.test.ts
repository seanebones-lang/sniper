import { describe, expect, it, vi, beforeEach } from 'vitest';

// In-memory live-intelligence state the mocked load/save read & mutate.
let intelState: {
  entriesPaused?: boolean;
  entriesPausedReason?: string;
  allowedKinds?: unknown;
} = {};
let roundTrips: { totalPnlUsd: number; roundTrips: number } = {
  totalPnlUsd: 0,
  roundTrips: 0,
};

const saveSpy = vi.fn(async (patch: Record<string, unknown>) => {
  intelState = { ...intelState, ...patch };
  return { ...intelState };
});

vi.mock('@/lib/monitoring/live-intelligence', () => ({
  loadLiveIntelligenceState: vi.fn(async () => ({ ...intelState })),
  saveLiveIntelligenceState: (patch: Record<string, unknown>) => saveSpy(patch),
}));

vi.mock('@/lib/execution/real-strategy-pnl', () => ({
  analyzeLiveRoundTrips: vi.fn(async () => ({ ...roundTrips })),
}));

vi.mock('@/lib/monitoring/system-state', () => ({
  loadSystemState: vi.fn(async () => ({
    startBankrollUsd: 20,
    dayUtc: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
  })),
  persistSystemState: vi.fn(async () => {}),
}));

import {
  evaluateLiveMicroGuards,
  isMicroDailyLossHaltReason,
  isMicroLiveAccount,
  LIVE_MICRO_DAILY_LOSS_PCT,
  LIVE_MICRO_MIN_CASH_USD,
  MICRO_DAILY_LOSS_HALT_MARKER,
} from './live-micro-guards';

const HALT_REASON = `24h PnL $-5.00 ${MICRO_DAILY_LOSS_HALT_MARKER}15% of session start $20.00`;

describe('live-micro-guards', () => {
  it('detects micro accounts at or below $25', () => {
    expect(isMicroLiveAccount(25)).toBe(true);
    expect(isMicroLiveAccount(10)).toBe(true);
    expect(isMicroLiveAccount(26)).toBe(false);
  });

  it('exports sane default thresholds', () => {
    // $1 floor matches Polymarket's $1 market-buy minimum for micro accounts.
    expect(LIVE_MICRO_MIN_CASH_USD).toBeGreaterThanOrEqual(1);
    expect(LIVE_MICRO_DAILY_LOSS_PCT).toBeGreaterThan(0);
    expect(LIVE_MICRO_DAILY_LOSS_PCT).toBeLessThan(0.5);
  });

  it('recognizes its own daily-loss halt reason', () => {
    expect(isMicroDailyLossHaltReason(HALT_REASON)).toBe(true);
    expect(
      isMicroDailyLossHaltReason('All allow-listed market kinds blocked — exit-only until manual review'),
    ).toBe(false);
    expect(isMicroDailyLossHaltReason(undefined)).toBe(false);
  });
});

describe('evaluateLiveMicroGuards daily-loss auto-recovery', () => {
  beforeEach(() => {
    intelState = { allowedKinds: ['short-crypto'] };
    roundTrips = { totalPnlUsd: 0, roundTrips: 0 };
    saveSpy.mockClear();
  });

  it('auto-clears a stale daily-loss halt once the 24h window recovers', async () => {
    intelState = {
      entriesPaused: true,
      entriesPausedReason: HALT_REASON,
      allowedKinds: ['short-crypto'],
    };
    roundTrips = { totalPnlUsd: 0.5, roundTrips: 1 }; // recovered: above loss limit

    const verdict = await evaluateLiveMicroGuards(10, 20);

    expect(verdict.entriesAllowed).toBe(true);
    expect(intelState.entriesPaused).toBe(false);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entriesPaused: false }),
    );
  });

  it('keeps the halt while the loss condition still holds (no redundant rewrite)', async () => {
    intelState = {
      entriesPaused: true,
      entriesPausedReason: HALT_REASON,
      allowedKinds: ['short-crypto'],
    };
    roundTrips = { totalPnlUsd: -5, roundTrips: 3 }; // still breached (limit is -$3)

    const verdict = await evaluateLiveMicroGuards(10, 20);

    expect(verdict.entriesAllowed).toBe(false);
    expect(verdict.code).toBe('micro_daily_loss_halt');
    expect(saveSpy).not.toHaveBeenCalled(); // already paused — don't rewrite
  });

  it('never auto-clears a kind-block / manual pause', async () => {
    intelState = {
      entriesPaused: true,
      entriesPausedReason: 'All allow-listed market kinds blocked — exit-only until manual review',
      allowedKinds: ['short-crypto'],
    };
    roundTrips = { totalPnlUsd: 5, roundTrips: 0 }; // fully recovered, but not our pause

    const verdict = await evaluateLiveMicroGuards(10, 20);

    expect(verdict.entriesAllowed).toBe(false);
    expect(verdict.code).toBe('entries_paused');
    expect(saveSpy).not.toHaveBeenCalled();
    expect(intelState.entriesPaused).toBe(true);
  });

  it('halts a fresh micro account that breaches the daily-loss limit', async () => {
    intelState = { allowedKinds: ['short-crypto'] };
    roundTrips = { totalPnlUsd: -5, roundTrips: 3 };

    const verdict = await evaluateLiveMicroGuards(10, 20);

    expect(verdict.entriesAllowed).toBe(false);
    expect(verdict.code).toBe('micro_daily_loss_halt');
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entriesPaused: true }),
    );
  });
});

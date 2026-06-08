import { describe, expect, it, vi, beforeEach } from 'vitest';

let intelState: Record<string, unknown> = {};
let attr: {
  byKind: Record<string, { trips: number; wins: number; pnlUsd: number }>;
  totalPnlUsd: number;
  roundTrips: number;
  winRatePct: number;
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
  analyzeLiveRoundTrips: vi.fn(async () => ({ ...attr })),
}));

vi.mock('@/lib/monitoring/live-trade-outcomes', () => ({
  getRecentLiveOutcomes: vi.fn(async () => []),
}));

vi.mock('@/lib/db', () => ({
  db: { insert: () => ({ values: vi.fn().mockResolvedValue(undefined) }) },
  auditEvents: {},
}));

import { runLiveLearningCycle } from './live-learning';

const KIND_BLOCK_REASON = 'All allow-listed market kinds blocked — exit-only until manual review';

describe('runLiveLearningCycle kind-block resume', () => {
  beforeEach(() => {
    intelState = {};
    attr = { byKind: {}, totalPnlUsd: 0, roundTrips: 0, winRatePct: 50 };
    saveSpy.mockClear();
  });

  it('resumes entries when the last blocked kind recovers (block set drains to empty)', async () => {
    intelState = {
      entriesPaused: true,
      entriesPausedReason: KIND_BLOCK_REASON,
      blockedKinds: ['short-crypto'],
      allowedKinds: ['short-crypto'],
    };
    // short-crypto now has positive 24h edge → unblocked → blocked set empties.
    attr = {
      byKind: { 'short-crypto': { trips: 4, wins: 3, pnlUsd: 0.5 } },
      totalPnlUsd: 0.5,
      roundTrips: 4,
      winRatePct: 75,
    };

    const result = await runLiveLearningCycle(20);

    expect(result.patched).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entriesPaused: false, blockedKinds: [] }),
    );
    expect(intelState.entriesPaused).toBe(false);
  });

  it('keeps the pause latched while the allow-list is still fully blocked', async () => {
    intelState = {
      entriesPaused: true,
      entriesPausedReason: KIND_BLOCK_REASON,
      blockedKinds: ['short-crypto'],
      allowedKinds: ['short-crypto'],
    };
    // short-crypto still losing → stays blocked → allow-list fully blocked.
    attr = {
      byKind: { 'short-crypto': { trips: 4, wins: 0, pnlUsd: -0.5 } },
      totalPnlUsd: -0.5,
      roundTrips: 4,
      winRatePct: 0,
    };

    await runLiveLearningCycle(20);

    // Never auto-resumed, and the existing pause reason is not clobbered.
    expect(intelState.entriesPaused).toBe(true);
  });
});

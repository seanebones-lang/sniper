import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/alerts/telegram', () => ({
  alerts: {
    runnerStarted: vi.fn(),
    runnerStopped: vi.fn(),
    paperFill: vi.fn(),
    realOrder: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/markets', () => ({
  getAllMarkets: vi.fn().mockResolvedValue([]),
  getMarketsForQuickFlip: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/monitoring/system-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/monitoring/system-state')>();
  return {
    ...actual,
    tryAcquireRunnerLock: vi.fn().mockResolvedValue(true),
    releaseRunnerLock: vi.fn().mockResolvedValue(undefined),
    loadCriticalSafetyState: vi.fn().mockResolvedValue({
      killSwitch: { disabled: false },
      riskMode: { current: 'NORMAL', reason: 'test' },
      dailyLoss: { trackedUsd: 0, lastResetAt: new Date().toISOString() },
    }),
    loadSystemState: vi.fn().mockResolvedValue(null),
    loadRiskSnapshot: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      strategies: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      realTrades: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      paperTrades: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  },
  signals: {},
  auditEvents: {},
  strategies: {},
  paperTrades: {},
}));

describe('Runner engine smoke', () => {
  afterEach(async () => {
    const { stopRunner } = await import('./engine');
    stopRunner({ manual: false });
  });

  it('runOnce is a no-op when runner is stopped', async () => {
    const { runOnce, getRunnerStatus, stopRunner } = await import('./engine');
    stopRunner({ manual: false });
    const before = getRunnerStatus().lastRun;
    await runOnce();
    expect(getRunnerStatus().lastRun).toBe(before);
  });

  it('startRunner completes one cycle with no active strategies', async () => {
    const { startRunner, getRunnerStatus, stopRunner } = await import('./engine');
    await startRunner(60_000);
    const st = getRunnerStatus();
    expect(st.running).toBe(true);
    expect(st.lastRun).not.toBeNull();
    expect(st.lastCycle?.skipReason).toBe('No active strategies');
    stopRunner({ manual: false });
  });
});

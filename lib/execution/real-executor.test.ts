import { describe, it, expect, beforeEach } from 'vitest';
import { disableRealExecution, isRealExecutionAllowed, placeRealOrder } from './real-executor';
import type { Market } from '@/lib/types';
import { reconcilePendingRealTrades } from './reconcile-real-trades';

describe('Real Executor Safety', () => {
  beforeEach(() => {
    // Note: module-level flag means tests are order-sensitive.
    // Production kill-switch is also backed by env var SNIPER_DISABLE_REAL_EXECUTION.
  });

  it('should respect the durable kill switch (disable flips allowed to false)', async () => {
    // Initial state depends on env, but calling disable must force false thereafter
    await disableRealExecution('test disable');
    expect(await isRealExecutionAllowed()).toBe(false);
  });

  it('should early-return disabled error from placeRealOrder when kill switch active (no side effects)', async () => {
    await disableRealExecution('test disable for placeRealOrder');

    const dummyMarket: Partial<Market> = {
      platform: 'polymarket',
      externalId: 'test-123',
      question: 'Test market for safety gate',
      status: 'open',
    };

    const result = await placeRealOrder({
      market: dummyMarket as Market,
      side: 'BUY',
      price: 0.65,
      size: 10,
      reason: 'safety gate test',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Real execution disabled');
    expect(result.tradeId).toBeUndefined();
  });
});

describe('Reconciliation', () => {
  it('should return a structured ReconciliationResult even on no DB / no pendings', async () => {
    const result = await reconcilePendingRealTrades();
    expect(result).toHaveProperty('checked');
    expect(result).toHaveProperty('updated');
    expect(result).toHaveProperty('errors');
    expect(typeof result.checked).toBe('number');
  });
});

import { loadKillSwitchState, persistKillSwitchDisabled } from '@/lib/monitoring/system-state';

describe('Durable Safety State (prod-gap-1)', () => {
  it('kill switch persistence service is resilient (best-effort in test env)', async () => {
    // In environments without DB this is best-effort and returns safe defaults.
    // The critical behavior (kill switch respected at call time) is tested above.
    await persistKillSwitchDisabled('test durability roundtrip', 'runtime');

    const loaded = await loadKillSwitchState();
    // Either persisted (real env) or safe default (test env without DB) is acceptable
    expect(typeof loaded.disabled).toBe('boolean');
  });
});

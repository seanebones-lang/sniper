import { describe, it, expect, beforeEach } from 'vitest';
import { disableRealExecution, isRealExecutionAllowed, placeRealOrder } from './real-executor';
import type { Market } from '@/lib/types';
import { reconcilePendingRealTrades } from './reconcile-real-trades';

describe('Real Executor Safety', () => {
  beforeEach(() => {
    // Note: module-level flag means tests are order-sensitive.
    // Production kill-switch is also backed by env var SNIPER_DISABLE_REAL_EXECUTION.
  });

  it('should respect the in-memory kill switch (disable flips allowed to false)', () => {
    // Initial state depends on env, but calling disable must force false thereafter
    disableRealExecution();
    expect(isRealExecutionAllowed()).toBe(false);
  });

  it('should early-return disabled error from placeRealOrder when kill switch active (no side effects)', async () => {
    disableRealExecution();

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

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PaperSimulator } from '@/lib/execution/paper-simulator';
import { executionManager } from '@/lib/execution/execution-manager';

describe('PaperSimulator', () => {
  let sim: PaperSimulator;

  beforeEach(() => {
    sim = new PaperSimulator();
  });

  const market = {
    id: 'test',
    platform: 'polymarket' as const,
    externalId: 'token-123',
    question: 'Test market',
    status: 'open' as const,
    updatedAt: new Date().toISOString(),
  };

  it('immediate fills always succeed without order book', () => {
    const fill = sim.snipe({
      market,
      side: 'BUY',
      price: 0.25,
      size: 50,
      reason: 'Manual test',
      immediate: true,
    });

    expect(fill).not.toBeNull();
    expect(fill!.size).toBe(50);
    expect(fill!.price).toBe(0.25);
    expect(fill!.executionType).toBe('AGGRESSIVE');
  });

  it('rejects invalid price without order book when not immediate', () => {
    const fill = sim.snipe({
      market,
      side: 'BUY',
      price: 0.25,
      size: 50,
      reason: 'Should fail — no book',
      immediate: false,
    });

    expect(fill).toBeNull();
  });

  it('rejects out-of-range prices', () => {
    expect(
      sim.snipe({ market, side: 'BUY', price: 0, size: 10, reason: 'bad', immediate: true }),
    ).toBeNull();
    expect(
      sim.snipe({ market, side: 'BUY', price: 1, size: 10, reason: 'bad', immediate: true }),
    ).toBeNull();
  });

  describe('hydration safety (skipExecutionTracking)', () => {
    afterEach(() => vi.restoreAllMocks());

    it('replay fills update position but do NOT feed execution-health metrics', () => {
      const posted = vi.spyOn(executionManager, 'recordOrderPosted');
      const filled = vi.spyOn(executionManager, 'recordFill');

      const fill = sim.snipe({
        market,
        side: 'BUY',
        price: 0.25,
        size: 50,
        reason: 'hydrate from DB',
        immediate: true,
        skipExecutionTracking: true,
      });

      expect(fill).not.toBeNull();
      expect(sim.getPositions()).toHaveLength(1);
      expect(posted).not.toHaveBeenCalled();
      expect(filled).not.toHaveBeenCalled();
    });

    it('normal fills DO feed execution-health metrics', () => {
      const posted = vi.spyOn(executionManager, 'recordOrderPosted');

      sim.snipe({
        market,
        side: 'BUY',
        price: 0.25,
        size: 50,
        reason: 'live fill',
        immediate: true,
      });

      expect(posted).toHaveBeenCalled();
    });
  });
});

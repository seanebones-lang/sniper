import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionManager, ExecutionContext } from './execution-manager';

describe('ExecutionManager', () => {
  let manager: ExecutionManager;

  beforeEach(() => {
    manager = new ExecutionManager();
  });

  it('should record posted orders and track remaining size', () => {
    const orderId = manager.recordOrderPosted('market-123', 'BUY', 0.65, 100, false);
    expect(orderId).toBeTruthy();

    const health = manager.getMarketHealth('market-123');
    expect(health.recentFills).toBe(0);
  });

  it('should detect potential adverse selection on quick bad fills', () => {
    const orderId = manager.recordOrderPosted('adv-market', 'BUY', 0.50, 50, false);

    const result = manager.recordFill(orderId, 0.51, 50, new Date(Date.now() + 3000));

    expect(result.adverseSelectionLikely).toBe(true);
  });

  it('should return conservative WAIT when market health is very poor for real money', () => {
    // Simulate bad history
    const badOrderId = manager.recordOrderPosted('bad-market', 'BUY', 0.50, 10, true);
    manager.recordFill(badOrderId, 0.58, 10, new Date(Date.now() + 2000)); // big adverse move

    const decision = manager.decideExecution(
      { action: 'BUY', price: 0.52, size: 20 },
      { marketExternalId: 'bad-market' },
      {
        recentImbalance: 0.1,
        timeSinceSignal: 10,
        isRealMoney: true,
        openOrders: [],
      } as ExecutionContext
    );

    expect(decision.type).toBe('WAIT');
    expect(decision.reason).toContain('poor recent execution health');
  });

  it('should cancel conflicting orders when new signal arrives on opposite side', () => {
    manager.recordOrderPosted('conflict-market', 'SELL', 0.70, 30, false);

    const decision = manager.decideExecution(
      { action: 'BUY', price: 0.68, size: 25 },
      { marketExternalId: 'conflict-market' },
      {
        recentImbalance: 0,
        timeSinceSignal: 5,
        isRealMoney: false,
        openOrders: manager.getOpenOrdersForMarket('conflict-market'),
      } as ExecutionContext
    );

    expect(decision.type).toBe('CANCEL_ALL');
  });
});

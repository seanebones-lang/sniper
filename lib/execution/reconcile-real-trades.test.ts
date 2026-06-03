import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockPositionsFindFirst = vi.fn();

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      realTrades: { findFirst: mockFindFirst, findMany: vi.fn().mockResolvedValue([]) },
      positions: { findFirst: mockPositionsFindFirst },
    },
    update: mockUpdate,
    insert: mockInsert,
  },
  realTrades: { id: 'id', status: 'status' },
  positions: { id: 'id' },
  markets: {},
  auditEvents: {},
}));

vi.mock('@/lib/markets', () => ({
  ensureMarket: vi.fn().mockResolvedValue('market-db-id'),
}));

describe('recordRealFill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) });
    mockInsert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  });

  it('is idempotent when trade is already filled', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'trade-1',
      status: 'filled',
      platform: 'polymarket',
      marketExternalId: 'tok-1',
      side: 'BUY',
    });

    const { recordRealFill } = await import('./reconcile-real-trades');
    await recordRealFill({ tradeId: 'trade-1', filledSize: 100, filledPrice: 0.05 });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('updates trade and positions on first fill', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'trade-2',
      status: 'pending',
      platform: 'polymarket',
      marketExternalId: 'tok-2',
      side: 'BUY',
      txHash: 'order-abc',
    });
    mockPositionsFindFirst.mockResolvedValue(null);

    const setFn = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockUpdate.mockReturnValue({ set: setFn });

    const { recordRealFill } = await import('./reconcile-real-trades');
    await recordRealFill({ tradeId: 'trade-2', filledSize: 50, filledPrice: 0.04, txHash: 'order-abc' });

    expect(setFn).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalled();
  });
});

describe('tryImmediatePolymarketFill', () => {
  it('returns false when trade is missing or not polymarket', async () => {
    mockFindFirst.mockResolvedValue(null);
    const { tryImmediatePolymarketFill } = await import('./reconcile-real-trades');
    expect(await tryImmediatePolymarketFill('missing')).toBe(false);
  });
});

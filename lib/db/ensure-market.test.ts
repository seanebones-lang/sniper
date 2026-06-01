import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the db module before importing the function under test
vi.mock('@/lib/db', () => {
  const mockDb = {
    insert: vi.fn(),
  };

  return {
    db: mockDb,
    markets: {
      platform: 'platform',
      externalId: 'externalId',
      question: 'question',
      status: 'status',
      volume: 'volume',
      liquidity: 'liquidity',
      lastPrice: 'lastPrice',
      updatedAt: 'updatedAt',
    },
  };
});

import { ensureMarketRecord } from './ensure-market';
import { db } from '@/lib/db';

describe('ensureMarketRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw if platform or externalId is missing', async () => {
    await expect(
      ensureMarketRecord({ platform: '', externalId: 'foo' } as any)
    ).rejects.toThrow(/missing platform or externalId/);

    await expect(
      ensureMarketRecord({ platform: 'polymarket', externalId: '' } as any)
    ).rejects.toThrow(/missing platform or externalId/);
  });

  it('should perform upsert and return the id on success', async () => {
    const mockReturning = vi.fn().mockResolvedValue([{ id: 'test-uuid-123' }]);
    const mockOnConflict = vi.fn().mockReturnValue({ returning: mockReturning });
    const mockSet = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });
    const mockValues = vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict });

    (db.insert as any).mockReturnValue({
      values: mockValues,
    });

    const market = {
      platform: 'polymarket',
      externalId: '0xabc123',
      question: 'Will Trump win?',
      status: 'open',
      volume: 12345,
      liquidity: 5000,
      lastPrice: 0.52,
    };

    const result = await ensureMarketRecord(market as any);

    expect(result).toBe('test-uuid-123');
    expect(db.insert).toHaveBeenCalled();
  });

  it('should throw a clear error if the upsert does not return an id', async () => {
    const mockReturning = vi.fn().mockResolvedValue([{}]);
    const mockOnConflict = vi.fn().mockReturnValue({ returning: mockReturning });

    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoUpdate: mockOnConflict }),
    });

    const market = {
      platform: 'kalshi',
      externalId: 'some-ticker',
      question: 'Test market',
      status: 'open',
    };

    await expect(ensureMarketRecord(market as any)).rejects.toThrow(
      /upsert succeeded but no id returned/
    );
  });
});

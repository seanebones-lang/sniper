import { describe, it, expect } from 'vitest';
import { normalizeOrderBookLevels } from '@/lib/orderbook';

describe('normalizeOrderBookLevels', () => {
  it('sorts bids high-to-low and asks low-to-high', () => {
    const { bids, asks, mid, spread } = normalizeOrderBookLevels(
      [{ price: 0.44, size: 100 }, { price: 0.45, size: 50 }],
      [{ price: 0.55, size: 100 }, { price: 0.56, size: 50 }],
    );

    expect(bids[0].price).toBe(0.45);
    expect(asks[0].price).toBe(0.55);
    expect(mid).toBeCloseTo(0.5, 3);
    expect(spread).toBeCloseTo(0.1, 3);
  });

  it('computes mid from single-sided book', () => {
    const { mid } = normalizeOrderBookLevels(
      [{ price: 0.45, size: 100 }],
      [],
    );
    expect(mid).toBe(0.45);
  });
});

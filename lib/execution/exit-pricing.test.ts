import { describe, it, expect } from 'vitest';
import { resolveAskOnlySellLimitPrice, repriceStaleSellLimit } from './exit-pricing';

describe('exit-pricing', () => {
  it('uses best ask when no bids', () => {
    const price = resolveAskOnlySellLimitPrice(
      {
        platform: 'polymarket',
        marketExternalId: 't',
        asks: [{ price: 0.004, size: 100 }],
        bids: [],
      },
      0.003,
    );
    expect(price).toBe(0.004);
  });

  it('walks down when reprice target matches current', () => {
    const book = {
      platform: 'polymarket' as const,
      marketExternalId: 't',
      asks: [{ price: 0.004, size: 100 }],
      bids: [],
    };
    const next = repriceStaleSellLimit(0.004, book, 0.004);
    expect(next).toBe(0.01);
  });
});

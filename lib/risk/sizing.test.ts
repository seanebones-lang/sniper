import { describe, it, expect } from 'vitest';
import { usdCapToShares, computeFinalShareSize } from './sizing';

describe('risk sizing USD ↔ shares', () => {
  it('converts USD cap to floor shares', () => {
    expect(usdCapToShares(50, 0.5)).toBe(100);
    expect(usdCapToShares(49, 0.5)).toBe(98);
    expect(usdCapToShares(0, 0.5)).toBe(0);
  });

  it('quick-flip buy uses USD cap not share count', () => {
    const shares = computeFinalShareSize({
      requestedShares: 500,
      riskCapUsd: 25,
      price: 0.45,
      isQuickFlipBuy: true,
    });
    expect(shares).toBe(55); // floor(25/0.45)
    expect(shares * 0.45).toBeLessThanOrEqual(25);
  });

  it('non-quick-flip caps requested shares by USD', () => {
    const shares = computeFinalShareSize({
      requestedShares: 100,
      riskCapUsd: 50,
      price: 0.5,
      isQuickFlipBuy: false,
    });
    expect(shares).toBe(100); // min(100, floor(50/0.5))
  });

  it('rejects when USD cap yields zero shares', () => {
    expect(
      computeFinalShareSize({
        requestedShares: 10,
        riskCapUsd: 0.2,
        price: 0.5,
        isQuickFlipBuy: false,
        minSharesUsd: 1,
      }),
    ).toBe(0);
  });
});

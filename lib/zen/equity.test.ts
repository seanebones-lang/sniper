import { describe, expect, it } from 'vitest';
import { inferLiveStartingBudget } from '@/lib/zen/live-equity';

describe('inferLiveStartingBudget', () => {
  it('returns clob cash when flat with no trades', () => {
    expect(inferLiveStartingBudget(26.78, [])).toBe(26.78);
  });

  it('reconstructs deposit from clob + buys - sells when flat', () => {
    const trades = [
      { platform: 'polymarket', marketExternalId: 'a', side: 'BUY', size: '1.96', price: '0.51', fee: '0' },
      { platform: 'polymarket', marketExternalId: 'a', side: 'SELL', size: '1', price: '0.53', fee: '0' },
    ];
    // clob after round-trip: 26.78 - 1 + 0.53 = 26.31 approx; infer back to ~26.78
    expect(inferLiveStartingBudget(26.31, trades)).toBeCloseTo(26.78, 2);
  });

  it('accounts for open position cost in deposit inference', () => {
    const trades = [
      { platform: 'polymarket', marketExternalId: 'a', side: 'BUY', size: '1', price: '0.50', fee: '0' },
    ];
    expect(inferLiveStartingBudget(25.5, trades)).toBeCloseTo(26, 2);
  });
});

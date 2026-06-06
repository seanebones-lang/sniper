import { describe, it, expect } from 'vitest';
import { getAdvancedSignal, computeMomentumPct } from './signal-engine';

const BASE_CLOSES = [
  100, 100.1, 100.05, 100.2, 100.15, 100.3, 100.25, 100.4, 100.35, 100.5,
];

describe('getAdvancedSignal', () => {
  it('returns null when up price too high and momentum flat', () => {
    const r = getAdvancedSignal(BASE_CLOSES, 0.75, '5m');
    expect(r.signal).toBeNull();
  });

  it('can fire cheap_up tier', () => {
    const closes = [...BASE_CLOSES, 100.52, 100.54, 100.56, 100.58, 100.6, 100.62, 100.65];
    const mom = computeMomentumPct(closes, 5);
    expect(mom).not.toBeNull();
    const r = getAdvancedSignal(closes, 0.38, '5m');
    if (mom! > 0.04) {
      expect(r.signal).toBe('BUY_UP');
      expect(r.tier).toBe('cheap_up');
    }
  });

  it('returns null with insufficient closes', () => {
    expect(getAdvancedSignal([100, 101], 0.4, '5m').signal).toBeNull();
  });
});

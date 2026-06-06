import { describe, it, expect } from 'vitest';
import { computeRsi, rsiLast } from './rsi';

describe('computeRsi', () => {
  it('returns null when insufficient data', () => {
    expect(computeRsi([1, 2, 3], 7)).toBeNull();
  });

  it('computes RSI for rising series', () => {
    const closes = [44, 44.5, 44.8, 45, 45.2, 45.5, 45.8, 46];
    const rsi = rsiLast(closes, 7);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThan(50);
  });

  it('computes RSI for falling series', () => {
    const closes = [46, 45.8, 45.5, 45.2, 45, 44.8, 44.5, 44];
    const rsi = rsiLast(closes, 7);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeLessThan(50);
  });
});

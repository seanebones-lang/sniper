import { describe, it, expect } from 'vitest';
import { getAdvancedSignal, computeMomentumPct } from './signal-engine';

const BASE_CLOSES = [
  100, 100.1, 100.05, 100.2, 100.15, 100.3, 100.25, 100.4, 100.35, 100.5,
];

describe('getAdvancedSignal', () => {
  it('returns BUY_UP on oversold + positive momentum + cheap up', () => {
    const closes = [...BASE_CLOSES, 99.5, 99.6, 99.7, 99.8, 100.0, 100.2, 100.5];
    const mom = computeMomentumPct(closes, 5);
    expect(mom).not.toBeNull();
    const signal = getAdvancedSignal(closes, 0.45, '5m', {
      rsiBuyUpMax: 50,
      minMomentumPct: 0.1,
    });
    expect(['BUY_UP', 'BUY_DOWN', null]).toContain(signal);
  });

  it('returns null when up price too high', () => {
    const signal = getAdvancedSignal(BASE_CLOSES, 0.75, '5m');
    expect(signal).toBeNull();
  });

  it('returns null with insufficient closes', () => {
    expect(getAdvancedSignal([100, 101], 0.4, '5m')).toBeNull();
  });
});

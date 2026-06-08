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

  it('honors a lowered strongMomentumPct (tier-3 fires on a smaller move)', () => {
    // ~0.15% move over 5 bars at coin-flip odds: below the 0.22 default, above 0.12.
    const closes = [100, 100, 100, 100, 100, 100.05, 100.08, 100.1, 100.13, 100.15];
    const mom = computeMomentumPct(closes, 5);
    expect(mom).not.toBeNull();
    expect(mom!).toBeGreaterThan(0.12);
    expect(mom!).toBeLessThan(0.22);

    // Default threshold (0.22): no tier-3 entry.
    expect(getAdvancedSignal(closes, 0.5, '5m').signal).toBeNull();
    // Lowered threshold (0.12): tier-3 strong-momentum entry fires.
    const lowered = getAdvancedSignal(closes, 0.5, '5m', { strongMomentumPct: 0.12 });
    expect(lowered.signal).toBe('BUY_UP');
    expect(lowered.tier).toBe('strong_mom_up');
  });
});

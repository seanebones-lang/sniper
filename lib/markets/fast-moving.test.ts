import { describe, expect, it } from 'vitest';
import { assessFastMovingMarket, isQuickFlipCandidate, QUICK_FLIP_MAX_RESOLUTION_HOURS, resolvesWithinHours } from './fast-moving';
import type { Market } from '../types';

function market(question: string, volume = 0): Market {
  return {
    id: 'test',
    platform: 'polymarket',
    externalId: 'test-id',
    question,
    status: 'open',
    volume,
    updatedAt: new Date().toISOString(),
  };
}

describe('assessFastMovingMarket', () => {
  it('flags live tennis matchups', () => {
    const result = assessFastMovingMarket(
      market('Will Player A win set 2 vs Player B — live tennis match tonight?', 25_000),
    );
    expect(result.fast).toBe(true);
    expect(result.kind).toBe('sports-live');
  });

  it('flags NBA in-game markets', () => {
    const result = assessFastMovingMarket(
      market('Will the Lakers beat the Celtics in Q3 tonight?', 80_000),
    );
    expect(result.fast).toBe(true);
    expect(['sports-live', 'sports']).toContain(result.kind);
  });

  it('flags short crypto windows', () => {
    const result = assessFastMovingMarket(market('Will BTC be above $95k in the next 15m?'));
    expect(result.fast).toBe(true);
    expect(result.kind).toBe('short-crypto');
  });

  it('does not flag slow political markets', () => {
    const result = assessFastMovingMarket(
      market('Will the Senate pass the budget bill before 2028?'),
    );
    expect(result.fast).toBe(false);
  });

  it('does not treat World Cup outright winner markets as quick-flip candidates', () => {
    const m = market('Will Uzbekistan win the 2026 FIFA World Cup?', 500_000);
    m.endDate = '2026-07-19T00:00:00Z';
    expect(assessFastMovingMarket(m).fast).toBe(false);
    expect(isQuickFlipCandidate(m)).toBe(false);
  });

  it('accepts markets resolving within 3 hours only', () => {
    const m = market('Wuhan Tennis Open: Player A vs Player B', 5_000);
    const inTwoHours = new Date(Date.now() + 2 * 3600 * 1000);
    m.endDate = inTwoHours.toISOString();
    expect(isQuickFlipCandidate(m)).toBe(true);
    expect(resolvesWithinHours(m, QUICK_FLIP_MAX_RESOLUTION_HOURS)).toBe(true);
  });

  it('rejects markets resolving after 3 hours even with live tennis title', () => {
    const m = market('ATP: Sinner vs Alcaraz — Set 1 Winner (Live)', 5_000);
    const inFiveHours = new Date(Date.now() + 5 * 3600 * 1000);
    m.endDate = inFiveHours.toISOString();
    expect(isQuickFlipCandidate(m)).toBe(false);
  });

  it('rejects markets without endDate', () => {
    const m = market('ATP: Sinner vs Alcaraz — Set 1 Winner (Live)', 5_000);
    expect(isQuickFlipCandidate(m)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { assessFastMovingMarket } from './fast-moving';
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
});

import { describe, expect, it } from 'vitest';
import { isKindBlockedByIntelligence } from './live-intelligence';

describe('isKindBlockedByIntelligence', () => {
  it('blocks explicit blocked kinds', () => {
    expect(
      isKindBlockedByIntelligence('sports-live', {
        allowedKinds: ['short-crypto'],
        blockedKinds: ['sports-live'],
      }),
    ).toBe(true);
  });

  it('blocks kinds outside allowlist', () => {
    expect(
      isKindBlockedByIntelligence('sports-live', {
        allowedKinds: ['short-crypto'],
        blockedKinds: [],
      }),
    ).toBe(true);
  });

  it('allows short-crypto when in allowlist', () => {
    expect(
      isKindBlockedByIntelligence('short-crypto', {
        allowedKinds: ['short-crypto'],
        blockedKinds: [],
      }),
    ).toBe(false);
  });
});

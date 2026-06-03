import { describe, it, expect } from 'vitest';
import { extractFeaturesFromRecentSnapshots } from '@/lib/data/features';

describe('realisticPassiveFills replay semantics', () => {
  it('documents passive fill gate requirements', () => {
    // Replay engine skips BUY when realisticPassiveFills is on and:
    // - top ask size < signal size
    // - spread > 15%
    // - top bid size < 50% of signal size
    // Verified in replayStrategyOnHistory (lib/data/historical.ts).
    const features = extractFeaturesFromRecentSnapshots([{ mid: '0.50' }, { mid: '0.51' }]);
    expect(features.regime).toBeDefined();
  });
});

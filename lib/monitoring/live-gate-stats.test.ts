import { describe, expect, it } from 'vitest';
import { recordLiveGateBlock, drainCycleGateCounts } from './live-filter-snapshot';

describe('live-gate-stats', () => {
  it('records block codes in cycle buffer', () => {
    recordLiveGateBlock('kind_blocked');
    recordLiveGateBlock('kind_blocked');
    recordLiveGateBlock('spread_too_wide');
    const drained = drainCycleGateCounts();
    expect(drained.kind_blocked).toBe(2);
    expect(drained.spread_too_wide).toBe(1);
  });
});

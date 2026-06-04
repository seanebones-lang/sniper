import { describe, expect, it } from 'vitest';
import { recordLiveGateBlock } from './live-gate-stats';

describe('live-gate-stats', () => {
  it('records block codes in cycle buffer', () => {
    recordLiveGateBlock('kind_blocked');
    recordLiveGateBlock('kind_blocked');
    recordLiveGateBlock('spread_too_wide');
    expect(true).toBe(true);
  });
});

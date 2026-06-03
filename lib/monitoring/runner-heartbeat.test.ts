import { describe, it, expect } from 'vitest';
import { getRunnerMaxCycleAgeMs } from './runner-heartbeat';

describe('getRunnerMaxCycleAgeMs', () => {
  it('allows long cycles with post-cycle delay', () => {
    const max = getRunnerMaxCycleAgeMs(4000, 90_000);
    expect(max).toBeGreaterThan(180_000);
  });

  it('falls back to interval when no duration recorded', () => {
    expect(getRunnerMaxCycleAgeMs(4000, null)).toBeGreaterThanOrEqual(12_000);
  });
});

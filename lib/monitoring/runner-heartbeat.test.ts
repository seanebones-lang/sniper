import { describe, it, expect } from 'vitest';
import { getRunnerMaxCycleAgeMs } from './runner-heartbeat';

describe('getRunnerMaxCycleAgeMs', () => {
  it('allows long cycles with post-cycle delay', () => {
    const max = getRunnerMaxCycleAgeMs(4000, 90_000);
    expect(max).toBeGreaterThan(200_000);
  });

  it('uses conservative default when duration unknown', () => {
    expect(getRunnerMaxCycleAgeMs(4000, null)).toBeGreaterThanOrEqual(150_000);
  });
});

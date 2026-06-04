import { describe, expect, it } from 'vitest';
import {
  isMicroLiveAccount,
  LIVE_MICRO_DAILY_LOSS_PCT,
  LIVE_MICRO_MIN_CASH_USD,
} from './live-micro-guards';

describe('live-micro-guards', () => {
  it('detects micro accounts at or below $25', () => {
    expect(isMicroLiveAccount(25)).toBe(true);
    expect(isMicroLiveAccount(10)).toBe(true);
    expect(isMicroLiveAccount(26)).toBe(false);
  });

  it('exports sane default thresholds', () => {
    expect(LIVE_MICRO_MIN_CASH_USD).toBeGreaterThanOrEqual(5);
    expect(LIVE_MICRO_DAILY_LOSS_PCT).toBeGreaterThan(0);
    expect(LIVE_MICRO_DAILY_LOSS_PCT).toBeLessThan(0.5);
  });
});

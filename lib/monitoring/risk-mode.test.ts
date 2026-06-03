import { describe, it, expect } from 'vitest';
import { RiskModeManager } from './risk-mode';

describe('RiskModeManager restore + escalate (restart safety)', () => {
  it('restoreState applies a persisted non-NORMAL mode without re-evaluating', () => {
    const m = new RiskModeManager();
    expect(m.getCurrentMode().current).toBe('NORMAL');

    const when = new Date('2026-01-01T00:00:00Z');
    m.restoreState('DEFENSIVE', 'recovered after restart', when);

    const state = m.getCurrentMode();
    expect(state.current).toBe('DEFENSIVE');
    expect(state.reason).toContain('recovered');
    expect(state.enteredAt.toISOString()).toBe(when.toISOString());
    expect(m.getRiskMultiplier()).toBeLessThan(1);
  });

  it('escalateAtLeast raises but never lowers the posture', () => {
    const m = new RiskModeManager();

    m.escalateAtLeast('DEFENSIVE', 'low recovered health');
    expect(m.getCurrentMode().current).toBe('DEFENSIVE');

    // Asking for a *lower* posture must not downgrade us.
    m.escalateAtLeast('NORMAL', 'noop');
    expect(m.getCurrentMode().current).toBe('DEFENSIVE');

    // Escalating higher works.
    m.escalateAtLeast('EMERGENCY', 'crash');
    expect(m.getCurrentMode().current).toBe('EMERGENCY');
    expect(m.getRiskMultiplier()).toBeCloseTo(0.35);
  });
});

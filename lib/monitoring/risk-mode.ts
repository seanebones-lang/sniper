/**
 * Risk Mode System
 * 
 * Allows the runner to automatically shift into more defensive postures
 * when edge decay or poor execution health is detected.
 * 
 * This is one of the most important mechanisms for true 24/7 survival.
 */

export type RiskMode = 'NORMAL' | 'DEFENSIVE' | 'EMERGENCY';

export interface RiskModeState {
  current: RiskMode;
  reason: string;
  enteredAt: Date;
  previousMode: RiskMode;
}

import { persistSystemState } from './system-state';

export class RiskModeManager {
  private state: RiskModeState = {
    current: 'NORMAL',
    reason: 'Initial state',
    enteredAt: new Date(),
    previousMode: 'NORMAL',
  };

  getCurrentMode(): RiskModeState {
    return { ...this.state };
  }

  /**
   * Evaluate whether we should change risk mode based on current signals.
   */
  evaluate(
    systemHealthScore: number,
    adverseRate: number,
    decayingStrategies: number,
    unhealthyMarketCount: number
  ): { changed: boolean; newMode: RiskMode; reason: string } {
    const current = this.state.current;

    // EMERGENCY conditions
    if (
      systemHealthScore < 0.35 ||
      adverseRate > 0.55 ||
      (decayingStrategies >= 2 && systemHealthScore < 0.5)
    ) {
      if (current !== 'EMERGENCY') {
        const reason = `EMERGENCY: Health=${(systemHealthScore*100).toFixed(0)}%, Adverse=${(adverseRate*100).toFixed(0)}%, Decaying=${decayingStrategies}`;
        this._transition('EMERGENCY', reason);
        return { changed: true, newMode: 'EMERGENCY', reason };
      }
    }

    // DEFENSIVE conditions
    if (
      systemHealthScore < 0.55 ||
      adverseRate > 0.38 ||
      unhealthyMarketCount >= 3 ||
      decayingStrategies >= 1
    ) {
      if (current === 'NORMAL') {
        const reason = `DEFENSIVE: Health=${(systemHealthScore*100).toFixed(0)}%, Adverse=${(adverseRate*100).toFixed(0)}%, UnhealthyMarkets=${unhealthyMarketCount}`;
        this._transition('DEFENSIVE', reason);
        return { changed: true, newMode: 'DEFENSIVE', reason };
      }
    }

    // Recovery to NORMAL
    if (current !== 'NORMAL' && systemHealthScore > 0.72 && adverseRate < 0.25) {
      const reason = `Recovery to NORMAL: Health=${(systemHealthScore*100).toFixed(0)}%, Adverse=${(adverseRate*100).toFixed(0)}%`;
      this._transition('NORMAL', reason);
      return { changed: true, newMode: 'NORMAL', reason };
    }

    return { changed: false, newMode: current, reason: this.state.reason };
  }

  private _transition(newMode: RiskMode, reason: string) {
    this.state = {
      current: newMode,
      reason,
      enteredAt: new Date(),
      previousMode: this.state.current,
    };

    // Best-effort durability for the most important self-protection mechanism
    persistSystemState('risk_mode', {
      current: this.state.current,
      reason: this.state.reason,
      enteredAt: this.state.enteredAt.toISOString(),
    }, `risk mode transition to ${newMode}`).catch(() => {});
  }

  /**
   * Get a risk multiplier based on current mode (used for global position sizing).
   */
  getRiskMultiplier(): number {
    switch (this.state.current) {
      case 'EMERGENCY': return 0.35;
      case 'DEFENSIVE': return 0.65;
      case 'NORMAL': 
      default: return 1.0;
    }
  }
}

export const riskModeManager = new RiskModeManager();

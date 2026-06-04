/**
 * Edge Decay Monitor
 * 
 * Tracks strategy performance over sliding windows and detects degradation.
 * This is critical for long-term 24/7 operation.
 */

export interface StrategyPerformanceWindow {
  strategyId: string;
  windowStart: Date;
  windowEnd: Date;
  signals: number;
  fills: number;
  estimatedPnl: number;
  avgSlippage: number;
}

export class EdgeDecayMonitor {
  private windows: Map<string, StrategyPerformanceWindow[]> = new Map();

  recordWindow(strategyId: string, window: StrategyPerformanceWindow) {
    if (!this.windows.has(strategyId)) {
      this.windows.set(strategyId, []);
    }
    this.windows.get(strategyId)!.push(window);

    // Keep only last 20 windows per strategy
    const arr = this.windows.get(strategyId)!;
    if (arr.length > 20) arr.shift();
  }

  /**
   * Returns true if the strategy shows clear degradation over recent windows.
   */
  isDecaying(
    strategyId: string,
    bankrollUsd?: number,
  ): { decaying: boolean; severity: number; reason: string } {
    const history = this.windows.get(strategyId) || [];
    if (history.length < 3) {
      return { decaying: false, severity: 0, reason: 'Insufficient history' };
    }

    const recent = history.slice(-1);
    const older = history.slice(-4, -1);

    const recentPnl = recent.reduce((sum, w) => sum + w.estimatedPnl, 0);
    const olderPnl = older.length > 0 ? older.reduce((sum, w) => sum + w.estimatedPnl, 0) : 0;

    const bankroll = bankrollUsd != null && bankrollUsd > 0 ? bankrollUsd : 100;
    const microLive = bankroll < 150;

    if (microLive && recentPnl < -0.08 * bankroll) {
      return {
        decaying: true,
        severity: Math.min(1, Math.abs(recentPnl) / bankroll),
        reason: `Live micro decay: recent window PnL $${recentPnl.toFixed(2)} (< 8% of $${bankroll.toFixed(0)} bankroll)`,
      };
    }

    if (history.length < 4) {
      return { decaying: false, severity: 0, reason: 'Insufficient history' };
    }

    const recent4 = history.slice(-4);
    const older4 = history.slice(-8, -4);
    if (older4.length === 0) {
      return { decaying: false, severity: 0, reason: 'Insufficient history' };
    }

    const recentAvg = recent4.reduce((sum, w) => sum + w.estimatedPnl, 0) / recent4.length;
    const olderAvg = older4.reduce((sum, w) => sum + w.estimatedPnl, 0) / older4.length;
    const degradation = olderAvg - recentAvg;
    const severity = Math.max(0, degradation / Math.max(0.5, Math.abs(olderAvg)));

    if (severity > 0.5 && recentAvg < olderAvg * 0.5) {
      return {
        decaying: true,
        severity: Math.min(1, severity),
        reason: `Performance degradation (recent ${recentAvg.toFixed(2)} vs older ${olderAvg.toFixed(2)})`,
      };
    }

    return { decaying: false, severity, reason: 'No clear decay detected' };
  }

  getRecentWindows(strategyId: string, count = 6): StrategyPerformanceWindow[] {
    return (this.windows.get(strategyId) || []).slice(-count);
  }
}

export const edgeDecayMonitor = new EdgeDecayMonitor();

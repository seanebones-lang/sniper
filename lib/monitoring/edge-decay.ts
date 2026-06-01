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
  isDecaying(strategyId: string): { decaying: boolean; severity: number; reason: string } {
    const history = this.windows.get(strategyId) || [];
    if (history.length < 4) {
      return { decaying: false, severity: 0, reason: 'Insufficient history' };
    }

    const recent = history.slice(-4);
    const older = history.slice(-8, -4);

    if (older.length === 0) {
      return { decaying: false, severity: 0, reason: 'Insufficient history' };
    }

    const recentPnl = recent.reduce((sum, w) => sum + w.estimatedPnl, 0) / recent.length;
    const olderPnl = older.reduce((sum, w) => sum + w.estimatedPnl, 0) / older.length;

    const degradation = olderPnl - recentPnl;
    const severity = Math.max(0, degradation / Math.max(1, Math.abs(olderPnl)));

    if (severity > 0.6 && recentPnl < olderPnl * 0.5) {
      return {
        decaying: true,
        severity: Math.min(1, severity),
        reason: `Significant performance degradation (recent ${recentPnl.toFixed(2)} vs older ${olderPnl.toFixed(2)})`,
      };
    }

    return { decaying: false, severity, reason: 'No clear decay detected' };
  }

  getRecentWindows(strategyId: string, count = 6): StrategyPerformanceWindow[] {
    return (this.windows.get(strategyId) || []).slice(-count);
  }
}

export const edgeDecayMonitor = new EdgeDecayMonitor();

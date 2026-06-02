/**
 * Temporary Adjustments System
 * 
 * Allows the automated intelligence layer to temporarily change risk parameters
 * (e.g., global risk multiplier, strategy downweighting) with automatic expiration.
 * 
 * This is a key part of closing the intelligence loop safely.
 */

export interface TemporaryAdjustment {
  id: string;
  type: 'global_risk_multiplier' | 'strategy_downweight' | 'market_pause' | 'defensive_mode_boost';
  target?: string; // strategyId or marketExternalId
  value: number;   // e.g., 0.6 for multiplier, or 0.5 for downweight
  reason: string;
  expiresAfterRuns: number; // number of runner runs until auto-revert
  appliedAtRun: number;
  source: 'grok_auto' | 'manual';
}

const activeAdjustments: TemporaryAdjustment[] = [];
let currentRunCount = 0;

export function incrementRunCount() {
  currentRunCount++;
}

export function getCurrentRunCount(): number {
  return currentRunCount;
}

export function applyTemporaryAdjustment(adj: Omit<TemporaryAdjustment, 'id' | 'appliedAtRun'>): string {
  const id = `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const fullAdj: TemporaryAdjustment = {
    ...adj,
    id,
    appliedAtRun: currentRunCount,
  };

  // Remove any existing adjustment of the same type + target
  const existingIndex = activeAdjustments.findIndex(a => 
    a.type === adj.type && a.target === adj.target
  );
  if (existingIndex !== -1) {
    activeAdjustments.splice(existingIndex, 1);
  }

  activeAdjustments.push(fullAdj);
  return id;
}

export function getActiveAdjustments(): TemporaryAdjustment[] {
  return [...activeAdjustments];
}

export function getEffectiveGlobalRiskMultiplier(baseMultiplier: number): number {
  let multiplier = baseMultiplier;

  for (const adj of activeAdjustments) {
    if (adj.type === 'global_risk_multiplier') {
      multiplier *= adj.value;
    }
    if (adj.type === 'defensive_mode_boost' && adj.value < 1) {
      multiplier *= adj.value;
    }
  }

  return Math.max(0.1, Math.min(1.0, multiplier)); // safety bounds
}

export function getStrategySizeMultiplier(strategyId: string, baseMultiplier: number): number {
  let multiplier = baseMultiplier;

  for (const adj of activeAdjustments) {
    if (adj.type === 'strategy_downweight' && adj.target === strategyId) {
      multiplier *= adj.value;
    }
  }

  return Math.max(0.05, multiplier);
}

export function isMarketPaused(marketExternalId: string): boolean {
  return activeAdjustments.some(adj => 
    adj.type === 'market_pause' && adj.target === marketExternalId
  );
}

/**
 * Clean up expired adjustments. Call this at the start of every run.
 */
export function cleanupExpiredAdjustments(): TemporaryAdjustment[] {
  const stillActive = activeAdjustments.filter(adj => {
    const age = currentRunCount - adj.appliedAtRun;
    return age < adj.expiresAfterRuns;
  });

  const expired = activeAdjustments.filter(adj => {
    const age = currentRunCount - adj.appliedAtRun;
    return age >= adj.expiresAfterRuns;
  });

  // Replace the array contents
  activeAdjustments.length = 0;
  activeAdjustments.push(...stillActive);

  return expired;
}

export function getAdjustmentSummary(): string {
  if (activeAdjustments.length === 0) return 'No active temporary adjustments';

  return activeAdjustments.map(adj => {
    const remaining = adj.expiresAfterRuns - (currentRunCount - adj.appliedAtRun);
    return `${adj.type}${adj.target ? `(${adj.target})` : ''}: ${adj.value} (expires in ~${remaining} runs)`;
  }).join(' | ');
}

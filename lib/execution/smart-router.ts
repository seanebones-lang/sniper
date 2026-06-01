/**
 * Smart Execution Router
 * 
 * This is where theoretical edge becomes (or fails to become) real P&L.
 * 
 * Goals:
 * - Decide passive vs aggressive posting
 * - Detect potential adverse selection
 * - Route orders intelligently across venues when possible
 * 
 * This layer is one of the biggest differentiators between amateur and professional systems.
 */

import type { OrderBookLevel } from '../types';

export interface ExecutionDecision {
  recommendedAction: 'AGGRESSIVE' | 'PASSIVE' | 'WAIT' | 'CANCEL';
  targetPriceImprovement: number; // how much better than mid we should try for
  reason: string;
  maxSlippageTolerance: number;
}

export interface SmartExecutionInput {
  signal: { action: 'BUY' | 'SELL'; price: number; size: number; reason?: string };
  book: { marketExternalId?: string; bids?: OrderBookLevel[]; asks?: OrderBookLevel[]; spread?: number } | null | undefined;
  recentImbalance: number;
  timeSinceSignal: number;
  isRealMoney: boolean;
  regime?: string;
}

export function getSmartExecutionDecision(params: SmartExecutionInput): ExecutionDecision {
  const { signal, book, recentImbalance, timeSinceSignal, isRealMoney, regime = 'normal' } = params;

  if (!book || !book.bids?.length || !book.asks?.length) {
    return {
      recommendedAction: 'WAIT',
      targetPriceImprovement: 0,
      reason: 'Insufficient book depth',
      maxSlippageTolerance: 0.005,
    };
  }

  const spread = book.spread || (book.asks[0].price - book.bids[0].price);
  const ourSideImbalance = signal.action === 'BUY' ? recentImbalance : -recentImbalance;

  // In low liquidity regimes, almost always post passively
  if (regime === 'low_liquidity') {
    return {
      recommendedAction: 'PASSIVE',
      targetPriceImprovement: 0.006,
      reason: 'Low liquidity regime — post passively to avoid adverse selection',
      maxSlippageTolerance: 0.003,
    };
  }

  if (isRealMoney) {
    // Real capital: very conservative
    if (ourSideImbalance > 0.30 && spread < 0.015 && timeSinceSignal < 20) {
      return {
        recommendedAction: 'AGGRESSIVE',
        targetPriceImprovement: 0.0005,
        reason: 'Very strong imbalance + tight spread on real capital',
        maxSlippageTolerance: 0.0025,
      };
    }

    return {
      recommendedAction: 'PASSIVE',
      targetPriceImprovement: 0.005,
      reason: 'Default safe passive posting on real money',
      maxSlippageTolerance: 0.003,
    };
  }

  // Paper / research mode
  if (ourSideImbalance > 0.22 && timeSinceSignal < 30) {
    return {
      recommendedAction: 'AGGRESSIVE',
      targetPriceImprovement: 0,
      reason: 'Strong imbalance — taking aggressively for research',
      maxSlippageTolerance: 0.007,
    };
  }

  if (timeSinceSignal > 60) {
    return {
      recommendedAction: 'PASSIVE',
      targetPriceImprovement: 0.004,
      reason: 'Signal aging — post passively',
      maxSlippageTolerance: 0.004,
    };
  }

  return {
    recommendedAction: 'PASSIVE',
    targetPriceImprovement: 0.003,
    reason: 'Default balanced execution',
    maxSlippageTolerance: 0.005,
  };
}

/**
 * Basic adverse selection detector.
 * If we get filled very quickly on a limit order, it can be a warning sign.
 */
export function detectPotentialAdverseSelection(params: {
  timeToFillSeconds: number;
  sizeFilled: number;
  ourSide: 'BUY' | 'SELL';
  postFillPriceMove: number; // positive = price moved against us
}): { likelyAdverse: boolean; confidence: number; note: string } {
  const { timeToFillSeconds, sizeFilled, postFillPriceMove } = params;

  if (timeToFillSeconds < 4 && sizeFilled > 80 && Math.abs(postFillPriceMove) > 0.012) {
    return {
      likelyAdverse: true,
      confidence: 0.72,
      note: 'Fast fill on size + immediate adverse move — classic adverse selection pattern',
    };
  }

  if (timeToFillSeconds < 8 && postFillPriceMove > 0.008) {
    return {
      likelyAdverse: true,
      confidence: 0.55,
      note: 'Relatively fast fill followed by move against us',
    };
  }

  return { likelyAdverse: false, confidence: 0.2, note: 'No clear adverse selection signal' };
}


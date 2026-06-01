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

export interface ExecutionDecision {
  recommendedAction: 'AGGRESSIVE' | 'PASSIVE' | 'WAIT' | 'CANCEL';
  targetPriceImprovement: number; // how much better than mid we should try for
  reason: string;
  maxSlippageTolerance: number;
}

export function getSmartExecutionDecision(params: {
  signal: any;
  book: any;
  recentImbalance: number;
  timeSinceSignal: number; // seconds
  isRealMoney: boolean;
}): ExecutionDecision {
  const { signal, book, recentImbalance, timeSinceSignal, isRealMoney } = params;

  if (!book || !book.bids?.length || !book.asks?.length) {
    return {
      recommendedAction: 'WAIT',
      targetPriceImprovement: 0,
      reason: 'Insufficient book depth',
      maxSlippageTolerance: 0.005,
    };
  }

  const mid = book.mid || (book.bids[0].price + book.asks[0].price) / 2;
  const spread = book.spread || (book.asks[0].price - book.bids[0].price);

  // Strong imbalance in our direction → be more aggressive
  const ourSideImbalance = signal.action === 'BUY' ? recentImbalance : -recentImbalance;

  if (isRealMoney) {
    // On real money we are much more conservative
    if (ourSideImbalance > 0.25 && spread < 0.018) {
      return {
        recommendedAction: 'AGGRESSIVE',
        targetPriceImprovement: 0.001,
        reason: 'Strong confirming imbalance on real capital',
        maxSlippageTolerance: 0.004,
      };
    }

    return {
      recommendedAction: 'PASSIVE',
      targetPriceImprovement: 0.004,
      reason: 'Default to passive on real money for better fills',
      maxSlippageTolerance: 0.003,
    };
  }

  // Paper / research mode — we can be more aggressive for data collection
  if (ourSideImbalance > 0.18) {
    return {
      recommendedAction: 'AGGRESSIVE',
      targetPriceImprovement: 0,
      reason: 'Good imbalance confirmation',
      maxSlippageTolerance: 0.006,
    };
  }

  if (timeSinceSignal > 45) {
    return {
      recommendedAction: 'PASSIVE',
      targetPriceImprovement: 0.003,
      reason: 'Signal is aging — post passively',
      maxSlippageTolerance: 0.004,
    };
  }

  return {
    recommendedAction: 'PASSIVE',
    targetPriceImprovement: 0.002,
    reason: 'Default conservative execution',
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


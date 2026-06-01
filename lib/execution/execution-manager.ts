/**
 * ExecutionManager
 * 
 * The central brain for all order execution decisions.
 * This is one of the highest-leverage components for turning theoretical edge
 * into realized, consistent profit.
 *
 * Responsibilities:
 * - Decide passive vs aggressive execution
 * - Manage lifecycle of resting orders (post, adjust, cancel)
 * - Detect and respond to adverse selection in real time
 * - Track execution quality per fill and per strategy
 * - Provide a clean interface for both paper simulation and real trading
 */

import { getSmartExecutionDecision, detectPotentialAdverseSelection } from './smart-router';

export type ExecutionAction =
  | { type: 'POST_PASSIVE'; price: number; size: number; reason: string }
  | { type: 'TAKE_AGGRESSIVE'; price: number; size: number; reason: string }
  | { type: 'WAIT'; reason: string }
  | { type: 'CANCEL_ALL'; reason: string }
  | { type: 'CANCEL_AND_REPOST'; price: number; size: number; reason: string };

export interface OpenOrder {
  id: string;
  marketExternalId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  remainingSize: number;
  postedAt: Date;
  lastUpdate: Date;
}

export interface ExecutionContext {
  regime?: string;
  recentImbalance: number;
  timeSinceSignal: number;
  isRealMoney: boolean;
  openOrders: OpenOrder[];
  lastFillTimestamp?: Date;
  lastFillPrice?: number;
}

export interface ExecutionQuality {
  signalId?: string;
  expectedPrice: number;
  realizedPrice: number;
  slippage: number;           // positive = worse than expected
  fillTimeMs: number;
  wasAdverse: boolean;
  notes: string;
}

export class ExecutionManager {
  private openOrders: Map<string, OpenOrder> = new Map(); // key = marketExternalId
  private executionHistory: ExecutionQuality[] = [];

  /**
   * Main decision function. Called for every signal before any order is sent.
   */
  decideExecution(
    signal: { action: 'BUY' | 'SELL'; price: number; size: number; reason?: string },
    book: any,
    context: ExecutionContext
  ): ExecutionAction {
    const decision = getSmartExecutionDecision({
      signal,
      book,
      recentImbalance: context.recentImbalance,
      timeSinceSignal: context.timeSinceSignal,
      isRealMoney: context.isRealMoney,
      regime: context.regime,
    });

    const existingOrders = this.getOpenOrdersForMarket(book?.marketExternalId || '');

    // If we already have resting orders on the wrong side or in bad conditions, cancel them
    if (existingOrders.length > 0) {
      const wrongSide = existingOrders.some(o => o.side !== signal.action);
      if (wrongSide || decision.recommendedAction === 'CANCEL') {
        return {
          type: 'CANCEL_ALL',
          reason: 'Existing orders conflict with new signal or adverse conditions',
        };
      }
    }

    if (decision.recommendedAction === 'AGGRESSIVE') {
      return {
        type: 'TAKE_AGGRESSIVE',
        price: signal.price,
        size: signal.size,
        reason: decision.reason,
      };
    }

    if (decision.recommendedAction === 'PASSIVE') {
      // Post a passive limit slightly better than the decision target for queue priority
      const improvedPrice = signal.action === 'BUY'
        ? Math.max(0.01, signal.price - decision.targetPriceImprovement)
        : Math.min(0.99, signal.price + decision.targetPriceImprovement);

      return {
        type: 'POST_PASSIVE',
        price: improvedPrice,
        size: signal.size,
        reason: `${decision.reason} (posting passive at ${improvedPrice.toFixed(4)})`,
      };
    }

    return {
      type: 'WAIT',
      reason: decision.reason,
    };
  }

  /**
   * Called when we actually post or take an order (paper or real).
   * Tracks the order for lifecycle management.
   */
  recordOrderPosted(
    marketExternalId: string,
    side: 'BUY' | 'SELL',
    price: number,
    size: number,
    isReal: boolean
  ): string {
    const id = `order_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const order: OpenOrder = {
      id,
      marketExternalId,
      side,
      price,
      size,
      remainingSize: size,
      postedAt: new Date(),
      lastUpdate: new Date(),
    };

    this.openOrders.set(id, order);
    return id;
  }

  /**
   * Called on every fill (paper or real). Updates state and checks for adverse selection.
   */
  recordFill(
    orderId: string,
    fillPrice: number,
    fillSize: number,
    timestamp: Date = new Date()
  ): { adverseSelectionLikely: boolean; quality?: ExecutionQuality } {
    const order = this.openOrders.get(orderId);
    if (!order) return { adverseSelectionLikely: false };

    order.remainingSize -= fillSize;
    order.lastUpdate = timestamp;

    if (order.remainingSize <= 0.0001) {
      this.openOrders.delete(orderId);
    }

    // Basic adverse selection check
    const adverse = this.checkAdverseSelection(order, fillPrice, timestamp);

    const quality: ExecutionQuality = {
      expectedPrice: order.price,
      realizedPrice: fillPrice,
      slippage: order.side === 'BUY' 
        ? fillPrice - order.price 
        : order.price - fillPrice,
      fillTimeMs: timestamp.getTime() - order.postedAt.getTime(),
      wasAdverse: adverse,
      notes: adverse ? 'Possible adverse selection detected' : '',
    };

    this.executionHistory.push(quality);

    // Keep history bounded
    if (this.executionHistory.length > 500) {
      this.executionHistory.shift();
    }

    return {
      adverseSelectionLikely: adverse,
      quality,
    };
  }

  private checkAdverseSelection(order: OpenOrder, fillPrice: number, fillTime: Date): boolean {
    // Simple heuristic: filled quickly and price has already moved against us
    const timeToFill = fillTime.getTime() - order.postedAt.getTime();
    const priceMove = order.side === 'BUY' 
      ? fillPrice - order.price 
      : order.price - fillPrice;

    return timeToFill < 8000 && priceMove > 0.008; // filled fast + price moved against us
  }

  getOpenOrdersForMarket(marketExternalId: string): OpenOrder[] {
    return Array.from(this.openOrders.values()).filter(o => o.marketExternalId === marketExternalId);
  }

  getRecentExecutionQuality(limit = 20): ExecutionQuality[] {
    return this.executionHistory.slice(-limit);
  }

  getAverageSlippage(lastN = 50): number {
    const recent = this.executionHistory.slice(-lastN);
    if (recent.length === 0) return 0;
    return recent.reduce((sum, q) => sum + q.slippage, 0) / recent.length;
  }

  /**
   * Emergency cancel all open orders (used by kill switches etc.)
   */
  cancelAll(): OpenOrder[] {
    const cancelled = Array.from(this.openOrders.values());
    this.openOrders.clear();
    return cancelled;
  }
}

// Singleton for the whole app (paper + real share the same manager for now)
export const executionManager = new ExecutionManager();

/**
 * ExecutionManager (v2)
 * 
 * Now with stronger adverse selection tracking and market-level health.
 */

import { getSmartExecutionDecision } from './smart-router';
import type { OrderBook } from '../types';

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
  slippage: number;
  fillTimeMs: number;
  wasAdverse: boolean;
  notes: string;
}

export interface MarketExecutionHealth {
  marketExternalId: string;
  recentAdverseCount: number;
  recentFills: number;
  avgSlippage: number;
  lastAdverseAt?: Date;
  healthScore: number; // 0-1, lower = worse
}

export class ExecutionManager {
  private openOrders: Map<string, OpenOrder> = new Map();
  private executionHistory: ExecutionQuality[] = [];
  private marketHealth: Map<string, MarketExecutionHealth> = new Map();

  decideExecution(
    signal: { action: 'BUY' | 'SELL'; price: number; size: number; reason?: string },
    book: { marketExternalId?: string } | null | undefined,
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

    const marketHealth = this.getMarketHealth(book?.marketExternalId || '');

    // If this market has been very adverse recently, be extremely conservative
    if (marketHealth.healthScore < 0.4 && context.isRealMoney) {
      return {
        type: 'WAIT',
        reason: `Market has poor recent execution health (${(marketHealth.healthScore * 100).toFixed(0)}%) — pausing`,
      };
    }

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
      const improvedPrice = signal.action === 'BUY'
        ? Math.max(0.01, signal.price - decision.targetPriceImprovement)
        : Math.min(0.99, signal.price + decision.targetPriceImprovement);

      return {
        type: 'POST_PASSIVE',
        price: improvedPrice,
        size: signal.size,
        reason: `${decision.reason} (posting passive)`,
      };
    }

    return {
      type: 'WAIT',
      reason: decision.reason,
    };
  }

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

    // Update per-market health
    this.updateMarketHealth(order.marketExternalId, quality);

    if (this.executionHistory.length > 500) {
      this.executionHistory.shift();
    }

    return {
      adverseSelectionLikely: adverse,
      quality,
    };
  }

  private checkAdverseSelection(order: OpenOrder, fillPrice: number, fillTime: Date): boolean {
    const timeToFill = fillTime.getTime() - order.postedAt.getTime();
    const priceMove = order.side === 'BUY' 
      ? fillPrice - order.price 
      : order.price - fillPrice;

    return timeToFill < 8000 && priceMove > 0.008;
  }

  private updateMarketHealth(marketExternalId: string, quality: ExecutionQuality) {
    let health = this.marketHealth.get(marketExternalId);

    if (!health) {
      health = {
        marketExternalId,
        recentAdverseCount: 0,
        recentFills: 0,
        avgSlippage: 0,
        healthScore: 1.0,
      };
      this.marketHealth.set(marketExternalId, health);
    }

    health.recentFills += 1;
    if (quality.wasAdverse) {
      health.recentAdverseCount += 1;
      health.lastAdverseAt = new Date();
    }

    // Simple exponential moving average for slippage
    const alpha = 0.2;
    health.avgSlippage = health.avgSlippage * (1 - alpha) + quality.slippage * alpha;

    // Health score: penalize high adverse rate and high slippage
    const adverseRate = health.recentAdverseCount / Math.max(1, health.recentFills);
    health.healthScore = Math.max(0.1, 1 - (adverseRate * 0.7) - (Math.max(0, health.avgSlippage) * 40));
  }

  getMarketHealth(marketExternalId: string): MarketExecutionHealth {
    return this.marketHealth.get(marketExternalId) || {
      marketExternalId,
      recentAdverseCount: 0,
      recentFills: 0,
      avgSlippage: 0,
      healthScore: 1.0,
    };
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

  cancelAll(): OpenOrder[] {
    const cancelled = Array.from(this.openOrders.values());
    this.openOrders.clear();
    return cancelled;
  }

  /**
   * Cancel all resting orders for a specific market (used by runner self-protection).
   */
  cancelOrdersForMarket(marketExternalId: string): OpenOrder[] {
    const toCancel: OpenOrder[] = [];
    for (const [id, order] of this.openOrders.entries()) {
      if (order.marketExternalId === marketExternalId) {
        toCancel.push(order);
        this.openOrders.delete(id);
      }
    }
    return toCancel;
  }

  /**
   * Returns markets that currently have poor execution health (for risk throttling)
   */
  getUnhealthyMarkets(threshold = 0.5): string[] {
    const unhealthy: string[] = [];
    for (const [market, health] of this.marketHealth.entries()) {
      if (health.healthScore < threshold) {
        unhealthy.push(market);
      }
    }
    return unhealthy;
  }

  /**
   * Advanced: Decide if we should cancel resting orders on a market right now
   * due to adverse selection signals or regime shift.
   */
  shouldCancelRestingOrders(marketExternalId: string, currentBook: OrderBook | null = null): { shouldCancel: boolean; reason: string } {
    const health = this.getMarketHealth(marketExternalId);

    if (health.healthScore < 0.35) {
      return {
        shouldCancel: true,
        reason: `Very poor recent execution health (${(health.healthScore * 100).toFixed(0)}%)`,
      };
    }

    // If we have recent adverse fills and the book is moving against our side, cancel
    const recentAdverse = this.executionHistory
      .filter(q => q.wasAdverse)
      .slice(-5);

    if (recentAdverse.length >= 3) {
      return {
        shouldCancel: true,
        reason: 'Multiple recent adverse selections detected',
      };
    }

    return { shouldCancel: false, reason: 'No strong cancel signal' };
  }

  /**
   * Get recommended action for managing existing resting orders on a market.
   */
  manageRestingOrders(marketExternalId: string, latestBook: OrderBook | null = null): ExecutionAction {
    const health = this.getMarketHealth(marketExternalId);
    const openOrders = this.getOpenOrdersForMarket(marketExternalId);

    if (openOrders.length === 0) {
      return { type: 'WAIT', reason: 'No resting orders to manage' };
    }

    const cancelCheck = this.shouldCancelRestingOrders(marketExternalId, latestBook);

    if (cancelCheck.shouldCancel) {
      return {
        type: 'CANCEL_ALL',
        reason: cancelCheck.reason,
      };
    }

    // Basic price adjustment logic: if book has moved significantly in our favor, consider improving price or canceling to re-post
    if (latestBook && openOrders.length > 0) {
      const ourSideOrders = openOrders.filter(o => o.side === 'BUY'); // simplify for now
      if (ourSideOrders.length > 0 && latestBook.bids?.length) {
        const bestBid = latestBook.bids[0].price;
        const ourBest = Math.max(...ourSideOrders.map(o => o.price));
        if (bestBid > ourBest + 0.01) {
          return {
            type: 'CANCEL_AND_REPOST',
            price: bestBid - 0.001,
            size: ourSideOrders[0].remainingSize,
            reason: 'Book moved in our favor — re-posting at better price',
          };
        }
      }
    }

    return {
      type: 'WAIT',
      reason: 'Resting orders look okay for now',
    };
  }

  /**
   * Handle a live book update — this is the key method for passive execution intelligence.
   * In a full implementation, the runner would call this frequently with fresh books.
   */
  handleBookUpdate(marketExternalId: string, book: OrderBook): ExecutionAction {
    if (!book) return { type: 'WAIT', reason: 'No book data' };

    const openOrders = this.getOpenOrdersForMarket(marketExternalId);
    if (openOrders.length === 0) {
      return { type: 'WAIT', reason: 'No resting orders' };
    }

    const health = this.getMarketHealth(marketExternalId);

    // Strong adverse signal → cancel everything
    if (health.healthScore < 0.35) {
      return {
        type: 'CANCEL_ALL',
        reason: `Very poor health (${(health.healthScore * 100).toFixed(0)}%) — canceling resting orders`,
      };
    }

    // Check for significant book movement against our positions
    const ourBuyOrders = openOrders.filter(o => o.side === 'BUY');
    const ourSellOrders = openOrders.filter(o => o.side === 'SELL');

    if (ourBuyOrders.length > 0 && book.asks?.length) {
      const bestAsk = book.asks[0].price;
      if (bestAsk < Math.min(...ourBuyOrders.map(o => o.price)) - 0.015) {
        return {
          type: 'CANCEL_ALL',
          reason: 'Book has moved significantly against our buy orders',
        };
      }
    }

    if (ourSellOrders.length > 0 && book.bids?.length) {
      const bestBid = book.bids[0].price;
      if (bestBid > Math.max(...ourSellOrders.map(o => o.price)) + 0.015) {
        return {
          type: 'CANCEL_ALL',
          reason: 'Book has moved significantly against our sell orders',
        };
      }
    }

    return {
      type: 'WAIT',
      reason: 'No strong adjustment signal from book',
    };
  }

  /**
   * Overall system execution health score (0-1)
   */
  getSystemHealthScore(): number {
    if (this.marketHealth.size === 0) return 1.0;

    const scores = Array.from(this.marketHealth.values()).map(h => h.healthScore);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg;
  }
}

export const executionManager = new ExecutionManager();

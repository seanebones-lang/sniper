/**
 * Paper Trading Simulator (Phase 2)
 * Deterministic + realistic enough for strategy validation.
 * Later phases will improve slippage, partial fills, and latency modeling.
 */

import type { Market, OrderBook } from '../types';
import { executionManager } from './execution-manager';

export interface PaperFill {
  id: string;
  marketExternalId: string;
  platform: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  fee: number;
  timestamp: string;
  reason: string;
  executionType?: 'PASSIVE' | 'AGGRESSIVE';
}

export interface PaperPosition {
  platform: string;
  marketExternalId: string;
  size: number;
  avgPrice: number;
}

export interface SnipeRequest {
  market: Market;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  reason: string;
  /** Order book context for ExecutionManager (runner provides this). */
  book?: OrderBook | null;
  /** Manual UI fills bypass ExecutionManager gating and always execute immediately. */
  immediate?: boolean;
  /** Exit orders (take profit / stop loss) — prefer immediate fill. */
  isExit?: boolean;
  /** Override minimum passive fill probability (0–1). */
  minFillProbability?: number;
}

const FEE_RATE = 0.0005;

export class PaperSimulator {
  private fills: PaperFill[] = [];
  private positions: Map<string, PaperPosition> = new Map();

  /**
   * Core snipe method. Now has much more realistic passive fill behavior.
   */
  snipe(req: SnipeRequest): PaperFill | null {
    const {
      market, side, price, size, reason, book = null,
      immediate = false, isExit = false, minFillProbability,
    } = req;

    if (size <= 0 || price <= 0 || price >= 1) {
      console.warn('[PaperSimulator] Invalid snipe params');
      return null;
    }

    // Exits and explicit immediate fills always execute (cap sell to open long)
    if (immediate || isExit) {
      const pos = this.positions.get(`${market.platform}:${market.externalId}`);
      if (side === 'SELL' && pos && pos.size > 0) {
        const capped = Math.min(size, pos.size);
        if (capped <= 0) {
          console.warn(`[PaperSimulator] No long position to sell on ${market.externalId}`);
          return null;
        }
        return this._recordAggressiveFill(market, side, price, capped, reason);
      }
      if (side === 'SELL' && (!pos || pos.size <= 0)) {
        console.warn(`[PaperSimulator] SELL rejected — no open long on ${market.externalId}`);
        return null;
      }
      return this._recordAggressiveFill(market, side, price, size, reason);
    }

    // Get current execution decision
    const decision = executionManager.decideExecution(
      { action: side, price, size, reason },
      book,
      {
        regime: 'normal',
        recentImbalance: 0.05,
        timeSinceSignal: 5,
        isRealMoney: false,
        openOrders: executionManager.getOpenOrdersForMarket(market.externalId),
      }
    );

    let execPrice = price;
    let executionType: 'PASSIVE' | 'AGGRESSIVE' = 'AGGRESSIVE';
    let fillProbability = 1.0;

    if (decision.type === 'POST_PASSIVE') {
      execPrice = decision.price;
      executionType = 'PASSIVE';

      // === Realistic Passive Fill Simulation ===
      // Base probability influenced by imbalance, regime, and time
      const imbalance = 0.05; // placeholder — in real system this would come from recent snapshots
      const regimeFactor = 1.0; // will be wired to actual regime later

      // Strong imbalance in our direction = higher fill probability
      const imbalanceBonus = side === 'BUY' ? Math.max(0, imbalance) * 0.6 : Math.max(0, -imbalance) * 0.6;

      fillProbability = Math.min(0.92, 0.35 + imbalanceBonus + (regimeFactor - 1) * 0.2);
      if (minFillProbability != null) {
        fillProbability = Math.max(fillProbability, minFillProbability);
      }

      // Simulate partial fills on passive orders
      const fillSize = size * fillProbability;

      const minFillRatio = minFillProbability != null ? Math.min(0.15, minFillProbability * 0.4) : 0.15;
      if (fillSize < size * minFillRatio) {
        // Too low probability — treat as no fill for now (realistic for passive in bad conditions)
        console.log(`[PaperSimulator] Passive order on ${market.externalId} had low fill probability (${(fillProbability * 100).toFixed(1)}%) — no fill this cycle`);
        return null;
      }

      // Record the (partial) fill
      const fee = fillSize * execPrice * FEE_RATE;

      const fill: PaperFill = {
        id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        marketExternalId: market.externalId,
        platform: market.platform,
        side,
        price: execPrice,
        size: fillSize,
        fee,
        timestamp: new Date().toISOString(),
        reason: `${reason} | ${decision.type} (passive fill prob ${(fillProbability * 100).toFixed(1)}%)`,
        executionType: 'PASSIVE',
      };

      this.fills.push(fill);
      this._updatePosition(fill);

      const orderId = executionManager.recordOrderPosted(market.externalId, side, execPrice, size);
      const { adverseSelectionLikely } = executionManager.recordFill(orderId, execPrice, fillSize);

      if (adverseSelectionLikely) {
        console.warn(`[PaperSimulator] Possible adverse selection on passive fill for ${market.externalId}`);
      }

      return fill;
    }

    if (decision.type === 'TAKE_AGGRESSIVE') {
      execPrice = decision.price;
      executionType = 'AGGRESSIVE';
      fillProbability = 0.97; // aggressive is usually filled, but not always in thin books
    }

    if (decision.type === 'WAIT' || decision.type === 'CANCEL_ALL') {
      console.log(`[PaperSimulator] ExecutionManager suggested ${decision.type}: ${decision.reason}`);
      return null;
    }

    return this._recordAggressiveFill(market, side, execPrice, size, `${reason} | ${executionType}`, executionType);
  }

  private _recordAggressiveFill(
    market: Market,
    side: 'BUY' | 'SELL',
    price: number,
    size: number,
    reason: string,
    executionType: 'PASSIVE' | 'AGGRESSIVE' = 'AGGRESSIVE',
  ): PaperFill {
    const fee = size * price * FEE_RATE;

    const fill: PaperFill = {
      id: `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      marketExternalId: market.externalId,
      platform: market.platform,
      side,
      price,
      size,
      fee,
      timestamp: new Date().toISOString(),
      reason,
      executionType,
    };

    this.fills.push(fill);
    this._updatePosition(fill);

    const orderId = executionManager.recordOrderPosted(market.externalId, side, price, size);
    executionManager.recordFill(orderId, price, size);

    return fill;
  }

  private _updatePosition(fill: PaperFill) {
    const key = `${fill.platform}:${fill.marketExternalId}`;
    const existing = this.positions.get(key) || {
      platform: fill.platform,
      marketExternalId: fill.marketExternalId,
      size: 0,
      avgPrice: 0,
    };

    const signedSize = fill.side === 'BUY' ? fill.size : -fill.size;

    if (existing.size === 0) {
      existing.avgPrice = fill.price;
      existing.size = signedSize;
    } else {
      const totalCost = existing.size * existing.avgPrice + signedSize * fill.price;
      const newSize = existing.size + signedSize;

      if (newSize !== 0) {
        existing.avgPrice = totalCost / newSize;
      }
      existing.size = newSize;
    }

    this.positions.set(key, existing);
  }

  getFills(limit = 50): PaperFill[] {
    return [...this.fills].reverse().slice(0, limit);
  }

  getPositions(): PaperPosition[] {
    return Array.from(this.positions.values()).filter(p => Math.abs(p.size) > 0.0001);
  }

  getPnL(currentPrices: Record<string, number>): number {
    let pnl = 0;
    for (const pos of this.positions.values()) {
      const key = `${pos.platform}:${pos.marketExternalId}`;
      const current = currentPrices[key];
      if (current != null && pos.size !== 0) {
        pnl += pos.size * (current - pos.avgPrice);
      }
    }
    return pnl;
  }

  reset() {
    this.fills = [];
    this.positions.clear();
  }
}

// Singleton for the whole app session (MVP)
export const paperSimulator = new PaperSimulator();

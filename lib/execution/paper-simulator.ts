/**
 * Paper Trading Simulator (Phase 2)
 * Deterministic + realistic enough for strategy validation.
 * Later phases will improve slippage, partial fills, and latency modeling.
 */

import type { Market } from '../types';

export interface PaperFill {
  id: string;
  marketExternalId: string;
  platform: string;
  side: 'BUY' | 'SELL';        // normalized
  price: number;               // 0-1
  size: number;
  fee: number;
  timestamp: string;
  reason: string;
}

export interface PaperPosition {
  platform: string;
  marketExternalId: string;
  size: number;                // positive = long, negative = short
  avgPrice: number;
}

export interface SnipeRequest {
  market: Market;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  reason: string;
}

const FEE_RATE = 0.0005; // 5bps placeholder (adjust per platform later)

export class PaperSimulator {
  private fills: PaperFill[] = [];
  private positions: Map<string, PaperPosition> = new Map(); // key: platform:externalId

  snipe(req: SnipeRequest): PaperFill | null {
    const { market, side, price, size, reason } = req;

    // Basic realism checks (will be replaced by real risk engine in Phase 3)
    if (size <= 0 || price <= 0 || price >= 1) {
      console.warn('[PaperSimulator] Invalid snipe params');
      return null;
    }

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
    };

    this.fills.push(fill);
    this._updatePosition(fill);

    console.log('[PaperSimulator] Fill recorded:', fill);
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

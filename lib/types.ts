/**
 * Unified domain types for Sniper (Polymarket + Kalshi)
 * Phase 1: Market data layer
 */

export type Platform = 'polymarket' | 'kalshi';

export type MarketStatus = 'open' | 'closed' | 'resolved';

export interface Market {
  id: string;                    // our internal uuid (once persisted)
  platform: Platform;
  externalId: string;            // Polymarket tokenId or Kalshi market_ticker
  question: string;
  status: MarketStatus;
  volume?: number;
  liquidity?: number;
  lastPrice?: number;            // 0-1 decimal (0.47 = 47%)
  updatedAt: string;             // ISO
}

export interface PricePoint {
  platform: Platform;
  marketExternalId: string;
  price: number;                 // normalized 0-1
  timestamp: string;
}

export interface OrderBookLevel {
  price: number;                 // 0-1
  size: number;                  // shares or contracts
}

export interface OrderBook {
  platform: Platform;
  marketExternalId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  mid?: number;
  spread?: number;
  timestamp: string;
}

// Strategy signal (will be expanded heavily in Phase 3)
export interface Signal {
  id?: string;
  strategyId?: string;
  market: Market;
  action: 'BUY' | 'SELL' | 'CANCEL';
  price: number;
  size: number;
  reason: string;
  createdAt: string;
}

// Basic risk / execution context (stub for now)
export interface RiskContext {
  maxSizeUsd: number;
  paperOnly: boolean;
}

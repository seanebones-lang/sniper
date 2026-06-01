import type { Market, OrderBook } from '../types';

export interface StrategyConfig {
  // Common
  maxSizeUsd: number;
  targetProfitPct: number;     // e.g. 2.5
  cooldownSeconds: number;

  // Strategy-specific
  minSpreadPct?: number;       // for spread-scalper
  entryThreshold?: number;     // for threshold strategy
  referenceType?: 'mid' | 'last' | 'vwap';
}

export interface StrategyContext {
  market: Market;
  book?: OrderBook;
  currentPrice?: number;
}

export interface StrategySignal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'CANCEL';
  price: number;
  size: number;
  reason: string;
  confidence?: number;
}

export interface Strategy {
  id: string;
  name: string;
  type: string;
  evaluate(ctx: StrategyContext, config: StrategyConfig): StrategySignal | null;
}

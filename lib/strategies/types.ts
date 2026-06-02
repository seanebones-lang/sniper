import type { Market, OrderBook } from '../types';

export interface StrategyConfig {
  // Common
  maxSizeUsd: number;
  targetProfitPct: number;     // e.g. 2.5
  cooldownSeconds: number;

  // Run profile (paper runner)
  tradingStyle?: 'aggressive' | 'balanced' | 'conservative';
  tradingGoal?: 'quick-flip' | 'spread-capture' | 'dip-buy' | 'swing';
  stopLossPct?: number;
  maxHoldSeconds?: number;
  allowScaleIn?: boolean;

  /** Quick-flip: sell when price reaches entry × this multiple (default 2.5 = $1 → ~$2.50) */
  targetProfitMultiple?: number;
  /** Quick-flip: sell when position USD value reaches this (overrides multiple if set) */
  targetExitValueUsd?: number;
  /** When true, only trade markets flagged as fast-moving / live */
  liveMarketsOnly?: boolean;

  /** Durable size multiplier (e.g. 0.5 = half allocation until cleared) */
  allocationDownweight?: number;

  // Strategy-specific
  minSpreadPct?: number;       // for spread-scalper
  entryThreshold?: number;     // for threshold strategy
  referenceType?: 'mid' | 'last' | 'vwap';
}

export interface StrategyContext {
  market: Market;
  book?: OrderBook;
  currentPrice?: number;
  regime?: string;
}

export interface StrategySignal {
  action: 'BUY' | 'SELL' | 'HOLD' | 'CANCEL';
  price: number;
  size: number;
  reason: string;
  confidence?: number;
  edge?: number;           // estimated edge in decimal (e.g. 0.04 = 4%)
}

export interface Strategy {
  id: string;
  name: string;
  type: string;
  evaluate(ctx: StrategyContext, config: StrategyConfig): StrategySignal | null;
}

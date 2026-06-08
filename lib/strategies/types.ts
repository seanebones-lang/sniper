import type { Market, OrderBook } from '../types';

export interface StrategyConfig {
  // Common
  maxSizeUsd: number;
  targetProfitPct: number;     // e.g. 2.5
  cooldownSeconds: number;

  // Run profile (paper runner)
  tradingStyle?: 'aggressive' | 'balanced' | 'conservative';
  tradingGoal?: 'quick-flip' | 'spread-capture' | 'dip-buy' | 'swing' | 'btc-momentum';
  stopLossPct?: number;
  maxHoldSeconds?: number;
  allowScaleIn?: boolean;

  /** Quick-flip: sell when price reaches entry × this multiple (default 2.5 = $1 → ~$2.50) */
  targetProfitMultiple?: number;
  /** Quick-flip: sell when position USD value reaches this (overrides multiple if set) */
  targetExitValueUsd?: number;
  /** Quick-flip: lowest ask price we'll buy. Blocks dead longshots (e.g. 0.1¢
   *  outcomes that almost always settle to zero and have no real exit). */
  minEntryPrice?: number;
  /** When true, only trade markets flagged as fast-moving / live */
  liveMarketsOnly?: boolean;

  /** Durable size multiplier (e.g. 0.5 = half allocation until cleared) */
  allocationDownweight?: number;

  /** Live: min (target-entry)/entry minus spread fraction (percent points, e.g. 6 = 6%) */
  minEdgeAfterSpreadPct?: number;

  /** btc-sniper: filter 5m, 15m, or both */
  btcWindowFilter?: '5' | '15' | 'both';
  rsiPeriod?: number;
  rsiBuyUpMax?: number;
  rsiBuyDownMin?: number;
  minMomentumPct?: number;
  maxImpliedPrice?: number;
  cheapImpliedMax?: number;
  cheapMinMomentumPct?: number;
  /** btc-sniper: highest ask we'll lift on the chosen side (exchange-priced cap). */
  maxEntryAsk?: number;
  minSpreadPct?: number;       // for spread-scalper
  maxSpreadPct?: number;       // for spread-scalper — skip broken books
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

import type { StrategyConfig } from './types';

export type TradingStyle = 'aggressive' | 'balanced' | 'conservative';
export type TradingGoal = 'quick-flip' | 'spread-capture' | 'dip-buy' | 'swing';

export interface ResolvedStrategyConfig extends StrategyConfig {
  tradingStyle: TradingStyle;
  tradingGoal: TradingGoal;
  stopLossPct: number;
  maxHoldSeconds: number;
  allowScaleIn: boolean;
  targetProfitMultiple: number;
  targetExitValueUsd: number;
  minEntryPrice: number;
  liveMarketsOnly: boolean;
  minEdgeAfterSpreadPct: number;
  /** Passive fill probability floor for paper execution (0–1) */
  minFillProbability: number;
  /** Use immediate (aggressive) paper fills for entries */
  aggressiveEntryFills: boolean;
  /** Use immediate fills for exit (take-profit / stop-loss) orders */
  aggressiveExitFills: boolean;
}

const STYLE_DEFAULTS: Record<TradingStyle, Partial<ResolvedStrategyConfig>> = {
  aggressive: {
    minFillProbability: 0.55,
    aggressiveEntryFills: true,
    aggressiveExitFills: true,
    cooldownSeconds: 60,
  },
  balanced: {
    minFillProbability: 0.35,
    aggressiveEntryFills: false,
    aggressiveExitFills: true,
    cooldownSeconds: 180,
  },
  conservative: {
    minFillProbability: 0.25,
    aggressiveEntryFills: false,
    aggressiveExitFills: false,
    cooldownSeconds: 300,
  },
};

/** Take-profit multiple for quick-flip exits (micro live: smaller target, faster exit). */
export const QUICK_FLIP_TAKE_PROFIT_MULTIPLE = 1.2;

/** Minimum fast-moving score for live quick-flip entries (filters dead tails). */
export const LIVE_QUICK_FLIP_MIN_MARKET_SCORE = 22;

/** Live entries below this price are lottery tickets with no exit liquidity. */
export const LIVE_QUICK_FLIP_MIN_ENTRY_PRICE = 0.015;

/** Live max ask — room for 1.5× exit; 0.48 allows active 47–48¢ up/down markets. */
export const LIVE_QUICK_FLIP_MAX_ENTRY_PRICE = 0.48;

/** Max spread (mid %) for live entries. */
export const LIVE_QUICK_FLIP_MAX_SPREAD_PCT = 25;

/** Bid notional must cover at least this fraction of stake USD. */
export const LIVE_QUICK_FLIP_MIN_BID_NOTIONAL_RATIO = 1;

/** Max entry price uses upper band (2×) so entries leave room to run toward 2×. */
export const QUICK_FLIP_MAX_ENTRY_MULTIPLE = 2;

const GOAL_DEFAULTS: Record<TradingGoal, Partial<ResolvedStrategyConfig>> = {
  'quick-flip': {
    maxSizeUsd: 1,
    targetProfitPct: 50,
    targetProfitMultiple: QUICK_FLIP_TAKE_PROFIT_MULTIPLE,
    targetExitValueUsd: 1.15,
    minEntryPrice: 0.001,
    stopLossPct: 15,
    maxHoldSeconds: 180,
    minEdgeAfterSpreadPct: 6,
    allowScaleIn: false,
    cooldownSeconds: 15,
    liveMarketsOnly: true,
    minFillProbability: 0.4,
    aggressiveEntryFills: true,
    aggressiveExitFills: true,
  },
  'spread-capture': {
    targetProfitPct: 2.5,
    stopLossPct: 3,
    maxHoldSeconds: 600,
    allowScaleIn: false,
  },
  'dip-buy': {
    targetProfitPct: 4,
    stopLossPct: 5,
    maxHoldSeconds: 3600,
    allowScaleIn: true,
  },
  swing: {
    targetProfitPct: 8,
    stopLossPct: 6,
    maxHoldSeconds: 86400,
    allowScaleIn: true,
  },
};

export const TRADING_STYLE_OPTIONS: Array<{ id: TradingStyle; label: string; description: string }> = [
  { id: 'aggressive', label: 'Aggressive', description: 'Faster fills, shorter cooldowns, tighter exits.' },
  { id: 'balanced', label: 'Balanced', description: 'Default — mix of passive entries and firm exits.' },
  { id: 'conservative', label: 'Conservative', description: 'Passive fills, longer holds, wider stops.' },
];

export const TRADING_GOAL_OPTIONS: Array<{ id: TradingGoal; label: string; description: string }> = [
  { id: 'quick-flip', label: 'Quick flips', description: '$1 in, sell at 1.2×; stop -15%; ~3 min max hold; crypto-focused live filters.' },
  { id: 'spread-capture', label: 'Spread capture', description: 'Enter on wide spreads, exit when spread narrows or target hit.' },
  { id: 'dip-buy', label: 'Buy the dip', description: 'Enter on cheap prices, hold for larger bounce.' },
  { id: 'swing', label: 'Swing', description: 'Fewer trades, wider profit targets, longer holds.' },
];

export function resolveStrategyConfig(raw: StrategyConfig): ResolvedStrategyConfig {
  const style = (raw.tradingStyle as TradingStyle) ?? 'balanced';
  const goal = (raw.tradingGoal as TradingGoal) ?? 'spread-capture';

  const goalDefaults = GOAL_DEFAULTS[goal];
  const styleDefaults = STYLE_DEFAULTS[style];
  const baseMaxSize = raw.maxSizeUsd ?? goalDefaults.maxSizeUsd ?? 100;

  return {
    minFillProbability: 0.35,
    aggressiveEntryFills: false,
    aggressiveExitFills: true,
    ...styleDefaults,
    ...goalDefaults,
    ...raw,
    tradingStyle: style,
    tradingGoal: goal,
    maxSizeUsd: baseMaxSize,
    targetProfitPct: raw.targetProfitPct ?? goalDefaults.targetProfitPct ?? 2.5,
    cooldownSeconds: raw.cooldownSeconds ?? styleDefaults.cooldownSeconds ?? goalDefaults.cooldownSeconds ?? 180,
    stopLossPct: raw.stopLossPct ?? goalDefaults.stopLossPct ?? 3,
    maxHoldSeconds: raw.maxHoldSeconds ?? goalDefaults.maxHoldSeconds ?? 600,
    allowScaleIn: raw.allowScaleIn ?? goalDefaults.allowScaleIn ?? false,
    targetProfitMultiple: raw.targetProfitMultiple ?? goalDefaults.targetProfitMultiple ?? 0,
    targetExitValueUsd:
      raw.targetExitValueUsd ??
      goalDefaults.targetExitValueUsd ??
      baseMaxSize * (goalDefaults.targetProfitMultiple ?? 0),
    minEntryPrice: raw.minEntryPrice ?? goalDefaults.minEntryPrice ?? 0,
    liveMarketsOnly: raw.liveMarketsOnly ?? goalDefaults.liveMarketsOnly ?? false,
    minEdgeAfterSpreadPct:
      raw.minEdgeAfterSpreadPct ?? goalDefaults.minEdgeAfterSpreadPct ?? 6,
  };
}

/**
 * Normalize stored config before save. `live-quick-flip` must always run as
 * quick-flip/aggressive regardless of what the UI accidentally stored.
 */
export function normalizeStrategyConfig(
  type: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...config };
  if (type === 'live-quick-flip') {
    next.tradingGoal = 'quick-flip';
    next.tradingStyle = 'aggressive';
    next.liveMarketsOnly = true;
    next.maxSizeUsd = next.maxSizeUsd ?? 1;
    next.targetProfitMultiple = QUICK_FLIP_TAKE_PROFIT_MULTIPLE;
    next.targetExitValueUsd = 1.15;
    next.targetProfitPct = 20;
    next.stopLossPct = 15;
    next.maxHoldSeconds = next.maxHoldSeconds ?? 180;
    next.cooldownSeconds = next.cooldownSeconds ?? 15;
    next.minEntryPrice = LIVE_QUICK_FLIP_MIN_ENTRY_PRICE;
    next.minEdgeAfterSpreadPct = 6;
  }
  return next;
}

/** Resolve which strategy implementation to run (DB `type` can drift from config). */
export function resolveStrategyImplType(
  type: string,
  raw: StrategyConfig | ResolvedStrategyConfig,
): string {
  const goal = raw.tradingGoal ?? 'spread-capture';
  const liveOnly = raw.liveMarketsOnly !== false;
  if (goal === 'quick-flip' && liveOnly) {
    return 'live-quick-flip';
  }
  if (type === 'live-quick-flip') {
    return 'live-quick-flip';
  }
  return type;
}

/** Resolve config for a strategy row, applying type-specific normalization first. */
export function resolveStrategyConfigForType(
  type: string,
  raw: StrategyConfig,
): ResolvedStrategyConfig {
  const implType = resolveStrategyImplType(type, raw);
  const normalized = normalizeStrategyConfig(implType, raw as unknown as Record<string, unknown>);
  return resolveStrategyConfig(normalized as unknown as StrategyConfig);
}

export function shouldUseImmediateFill(
  config: ResolvedStrategyConfig,
  action: 'BUY' | 'SELL',
  isExit: boolean,
): boolean {
  if (isExit) return config.aggressiveExitFills;
  return config.aggressiveEntryFills;
}

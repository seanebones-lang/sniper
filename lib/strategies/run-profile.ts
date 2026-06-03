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

const GOAL_DEFAULTS: Record<TradingGoal, Partial<ResolvedStrategyConfig>> = {
  'quick-flip': {
    maxSizeUsd: 1,
    targetProfitPct: 150,
    targetProfitMultiple: 2.5,
    targetExitValueUsd: 2.5,
    minEntryPrice: 0.1,
    stopLossPct: 12,
    maxHoldSeconds: 300,
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
  { id: 'quick-flip', label: 'Quick flips', description: '$1 in, sell at 2.5× on markets resolving within 3 hours only.' },
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
    next.targetProfitMultiple = next.targetProfitMultiple ?? 2.5;
    next.targetExitValueUsd = next.targetExitValueUsd ?? 2.5;
    next.targetProfitPct = next.targetProfitPct ?? 150;
    next.stopLossPct = next.stopLossPct ?? 12;
    next.maxHoldSeconds = next.maxHoldSeconds ?? 300;
    next.cooldownSeconds = next.cooldownSeconds ?? 15;
    next.minEntryPrice = next.minEntryPrice ?? 0.1;
  }
  return next;
}

/** Resolve config for a strategy row, applying type-specific normalization first. */
export function resolveStrategyConfigForType(
  type: string,
  raw: StrategyConfig,
): ResolvedStrategyConfig {
  const normalized = normalizeStrategyConfig(type, raw as unknown as Record<string, unknown>);
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

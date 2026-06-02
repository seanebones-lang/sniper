import type { StrategySignal } from './types';
import type { ResolvedStrategyConfig } from './run-profile';

export interface StrategyOpenPosition {
  platform: string;
  marketExternalId: string;
  netSize: number;
  avgEntryPrice: number;
  openedAt: Date;
  strategyId: string;
}

function positionValueUsd(position: StrategyOpenPosition, currentPrice: number): number {
  return position.netSize * currentPrice;
}

/**
 * Decide whether to exit an open long position (prediction-market paper long).
 */
export function evaluateExitSignal(
  position: StrategyOpenPosition,
  currentPrice: number | undefined,
  bookSpread: number | undefined,
  mid: number | undefined,
  config: ResolvedStrategyConfig,
  /** For replay — defaults to Date.now() */
  nowMs: number = Date.now(),
): StrategySignal | null {
  if (position.netSize <= 0.01 || !currentPrice || currentPrice <= 0) {
    return null;
  }

  const entry = position.avgEntryPrice;
  const profitPct = ((currentPrice - entry) / entry) * 100;
  const holdSeconds = (nowMs - position.openedAt.getTime()) / 1000;
  const valueUsd = positionValueUsd(position, currentPrice);

  const target = config.targetProfitPct;
  const stop = config.stopLossPct;
  const maxHold = config.maxHoldSeconds;

  const mult =
    config.targetProfitMultiple > 0
      ? config.targetProfitMultiple
      : config.tradingGoal === 'quick-flip'
        ? 2.5
        : 0;

  const exitValueTarget =
    config.targetExitValueUsd > 0
      ? config.targetExitValueUsd
      : config.tradingGoal === 'quick-flip' && mult > 0
        ? config.maxSizeUsd * mult
        : 0;

  // Quick-flip: instant exit at price multiple (e.g. 2.5× → $1 becomes ~$2.50)
  if (mult > 0) {
    const targetPrice = Math.min(0.99, entry * mult);
    if (currentPrice >= targetPrice) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `Quick-flip ${mult}× hit (${entry.toFixed(3)} → ${currentPrice.toFixed(3)}, ~$${valueUsd.toFixed(2)})`,
        confidence: 0.95,
        edge: (currentPrice - entry) / entry,
      };
    }
  }

  // Quick-flip: exit when position USD value reaches target (e.g. $2.50)
  if (exitValueTarget > 0 && valueUsd >= exitValueTarget) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Quick-flip value target $${exitValueTarget.toFixed(2)} reached (~$${valueUsd.toFixed(2)})`,
      confidence: 0.95,
      edge: (currentPrice - entry) / entry,
    };
  }

  // Take profit (percentage — used by non-quick-flip goals)
  if (config.tradingGoal !== 'quick-flip' && profitPct >= target) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Take profit +${profitPct.toFixed(2)}% (target ${target}%)`,
      confidence: 0.85,
      edge: profitPct / 100,
    };
  }

  // Stop loss
  if (profitPct <= -stop) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Stop loss ${profitPct.toFixed(2)}% (limit -${stop}%)`,
      confidence: 0.9,
    };
  }

  // Quick-flip / spread-capture: exit if held too long with any green
  if (holdSeconds >= maxHold) {
    if (profitPct > 0.05) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `Max hold ${Math.round(maxHold)}s — lock +${profitPct.toFixed(2)}%`,
        confidence: 0.7,
      };
    }
    if (config.tradingGoal === 'quick-flip' || config.tradingStyle === 'aggressive') {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `Max hold ${Math.round(maxHold)}s — cut at ${profitPct.toFixed(2)}%`,
        confidence: 0.6,
      };
    }
  }

  // Spread capture: exit when spread collapsed (edge gone)
  if (config.tradingGoal === 'spread-capture' && mid && bookSpread != null && mid > 0) {
    const spreadPct = (bookSpread / mid) * 100;
    const minSpread = config.minSpreadPct ?? 1.8;
    if (spreadPct < minSpread * 0.5 && profitPct > 0.2) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `Spread narrowed to ${spreadPct.toFixed(2)}% — take +${profitPct.toFixed(2)}%`,
        confidence: 0.75,
      };
    }
  }

  return null;
}

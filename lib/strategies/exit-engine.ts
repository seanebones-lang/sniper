import type { StrategySignal } from './types';
import type { ResolvedStrategyConfig } from './run-profile';
import { hoursUntilResolution, isLongDatedOutright, LIVE_MAX_RESOLUTION_HOURS } from '../markets/fast-moving';
import type { Market } from '../types';

export interface StrategyOpenPosition {
  platform: string;
  marketExternalId: string;
  netSize: number;
  avgEntryPrice: number;
  openedAt: Date;
  strategyId: string;
}

/** Hard floor — exit before total wipeout on illiquid tails. */
export const QUICK_FLIP_CATASTROPHIC_STOP_PCT = 80;

/** Exit losing positions this many minutes before market resolution. */
export const QUICK_FLIP_RESOLUTION_EXIT_MINUTES = 30;

function positionValueUsd(position: StrategyOpenPosition, currentPrice: number): number {
  return position.netSize * currentPrice;
}

function resolveProfitMultiple(config: ResolvedStrategyConfig): number {
  if (config.targetProfitMultiple > 0) return config.targetProfitMultiple;
  if (config.tradingGoal === 'quick-flip') return 1.5;
  return 0;
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
  /** Market resolution time — enables pre-expiry safety exit for quick-flip */
  marketEndDate?: string | Date | null,
  /** Market metadata for live policy exits (24h resolution cap) */
  market?: Pick<Market, 'question' | 'endDate' | 'btcWindowMinutes'>,
): StrategySignal | null {
  if (position.netSize <= 0.01 || !currentPrice || currentPrice <= 0) {
    return null;
  }

  // Live spread-capture policy: never hold markets outside the 24h resolution window.
  if (config.tradingGoal === 'spread-capture') {
    if (market && isLongDatedOutright(market as Market)) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: 'Policy exit — long-dated market (live max 24h resolution)',
        confidence: 0.9,
      };
    }
    const endRef = marketEndDate ?? market?.endDate;
    if (endRef) {
      const hoursLeft = hoursUntilResolution({ endDate: endRef } as Market, nowMs);
      if (hoursLeft == null || hoursLeft > LIVE_MAX_RESOLUTION_HOURS) {
        return {
          action: 'SELL',
          price: currentPrice,
          size: Math.floor(position.netSize),
          reason: `Policy exit — resolution ${hoursLeft != null ? `${hoursLeft.toFixed(1)}h` : 'unknown'} away (max ${LIVE_MAX_RESOLUTION_HOURS}h)`,
          confidence: 0.9,
        };
      }
    } else if (market && !market.endDate) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: 'Policy exit — no resolution date (live max 24h)',
        confidence: 0.88,
      };
    }
  }

  const entry = position.avgEntryPrice;
  const profitPct = ((currentPrice - entry) / entry) * 100;
  const holdSeconds = (nowMs - position.openedAt.getTime()) / 1000;
  const valueUsd = positionValueUsd(position, currentPrice);

  const target = config.targetProfitPct;
  const stop = config.stopLossPct;
  const maxHold = config.maxHoldSeconds;
  const isQuickFlip = config.tradingGoal === 'quick-flip';
  const isBtcMomentum = config.tradingGoal === 'btc-momentum';

  const mult = resolveProfitMultiple(config);

  const exitValueTarget =
    config.targetExitValueUsd > 0
      ? config.targetExitValueUsd
      : isQuickFlip && mult > 0
        ? config.maxSizeUsd * mult
        : 0;

  // Quick-flip: take profit at price multiple (default 1.5×)
  if (isQuickFlip && mult > 0) {
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

  // Quick-flip: exit when position USD value reaches target (e.g. $1.50 on $1 stake)
  if (isQuickFlip && exitValueTarget > 0 && valueUsd >= exitValueTarget) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Quick-flip value target $${exitValueTarget.toFixed(2)} reached (~$${valueUsd.toFixed(2)})`,
      confidence: 0.95,
      edge: (currentPrice - entry) / entry,
    };
  }

  // BTC momentum: hard stop — cut fast (cycles can be 30–90s on micro)
  if (isBtcMomentum && profitPct <= -Math.min(stop, 4)) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `BTC sniper stop ${profitPct.toFixed(2)}% (limit -${Math.min(stop, 4)}%)`,
      confidence: 0.92,
    };
  }

  // BTC momentum: take profit
  if (isBtcMomentum && profitPct >= target) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Take profit +${profitPct.toFixed(2)}% (target ${target}%)`,
      confidence: 0.85,
      edge: profitPct / 100,
    };
  }

  // Quick-flip: catastrophic stop before worthless expiry
  if (isQuickFlip && profitPct <= -QUICK_FLIP_CATASTROPHIC_STOP_PCT) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Catastrophic stop ${profitPct.toFixed(2)}% (limit -${QUICK_FLIP_CATASTROPHIC_STOP_PCT}%)`,
      confidence: 0.92,
    };
  }

  // Stop loss (quick-flip default 30% — hold through noise, cut before half gone)
  if (profitPct <= -stop) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason: `Stop loss ${profitPct.toFixed(2)}% (limit -${stop}%)`,
      confidence: 0.9,
    };
  }

  // Quick-flip: don't ride losers into resolution — exit if red within 30 min of end
  if (isQuickFlip && marketEndDate && profitPct < 0) {
    const hoursLeft = hoursUntilResolution(
      { endDate: marketEndDate } as import('../types').Market,
      nowMs,
    );
    if (
      hoursLeft != null &&
      hoursLeft >= 0 &&
      hoursLeft <= QUICK_FLIP_RESOLUTION_EXIT_MINUTES / 60
    ) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `Pre-resolution exit ${profitPct.toFixed(2)}% (${(hoursLeft * 60).toFixed(0)}m to close)`,
        confidence: 0.75,
      };
    }
  }

  // BTC momentum: exit before window close if still red
  if (isBtcMomentum && marketEndDate && profitPct < 0) {
    const hoursLeft = hoursUntilResolution(
      { endDate: marketEndDate } as import('../types').Market,
      nowMs,
    );
    const exitMinutes = market?.btcWindowMinutes
      ? Math.min(2, market.btcWindowMinutes * 0.4)
      : 2;
    if (
      hoursLeft != null &&
      hoursLeft >= 0 &&
      hoursLeft <= exitMinutes / 60
    ) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `BTC pre-window exit ${profitPct.toFixed(2)}% (${(hoursLeft * 60).toFixed(0)}m to close)`,
        confidence: 0.8,
      };
    }
  }

  // BTC momentum: time stop
  if (isBtcMomentum && maxHold > 0 && holdSeconds >= maxHold) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason:
        profitPct >= 0
          ? `BTC sniper max hold ${Math.round(maxHold)}s — lock +${profitPct.toFixed(2)}%`
          : `BTC sniper max hold ${Math.round(maxHold)}s — cut at ${profitPct.toFixed(2)}%`,
      confidence: 0.82,
      edge: (currentPrice - entry) / entry,
    };
  }

  // Quick-flip: time stop — don't bag-hold past maxHoldSeconds (e.g. 90–180s).
  if (isQuickFlip && maxHold > 0 && holdSeconds >= maxHold) {
    return {
      action: 'SELL',
      price: currentPrice,
      size: Math.floor(position.netSize),
      reason:
        profitPct >= 0
          ? `Quick-flip max hold ${Math.round(maxHold)}s — lock +${profitPct.toFixed(2)}%`
          : `Quick-flip max hold ${Math.round(maxHold)}s — cut at ${profitPct.toFixed(2)}%`,
      confidence: 0.82,
      edge: (currentPrice - entry) / entry,
    };
  }

  // Non-quick-flip: time-based exits
  if (!isQuickFlip && holdSeconds >= maxHold) {
    if (profitPct > 0.05) {
      return {
        action: 'SELL',
        price: currentPrice,
        size: Math.floor(position.netSize),
        reason: `Max hold ${Math.round(maxHold)}s — lock +${profitPct.toFixed(2)}%`,
        confidence: 0.7,
      };
    }
    if (config.tradingStyle === 'aggressive') {
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

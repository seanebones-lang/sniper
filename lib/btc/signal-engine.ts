import { rsiLast } from '@/lib/indicators/rsi';

export type BtcSniperSignal = 'BUY_UP' | 'BUY_DOWN' | null;

export type BtcSignalParams = {
  rsiPeriod?: number;
  rsiBuyUpMax?: number;
  rsiBuyDownMin?: number;
  minMomentumPct?: number;
  maxImpliedPrice?: number;
  /** Cheap-side fallback: buy when implied < this and momentum aligns */
  cheapImpliedMax?: number;
  cheapMinMomentumPct?: number;
};

const DEFAULTS: Required<BtcSignalParams> = {
  rsiPeriod: 7,
  rsiBuyUpMax: 45,
  rsiBuyDownMin: 55,
  minMomentumPct: 0.12,
  maxImpliedPrice: 0.58,
  cheapImpliedMax: 0.42,
  cheapMinMomentumPct: 0.04,
};

export function computeMomentumPct(closes: number[], lookback = 5): number | null {
  if (closes.length < lookback + 1) return null;
  const prev = closes[closes.length - 1 - lookback];
  const last = closes[closes.length - 1];
  if (prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

export type SignalResult = {
  signal: BtcSniperSignal;
  tier: string | null;
  rsi: number | null;
  momentum: number | null;
};

export function getAdvancedSignal(
  closes: number[],
  upPrice: number,
  _marketType: '5m' | '15m',
  params: BtcSignalParams = {},
): SignalResult {
  const p = { ...DEFAULTS, ...params };
  const rsi = rsiLast(closes, p.rsiPeriod);
  const momentum = computeMomentumPct(closes, 5);
  const downPrice = 1 - upPrice;

  if (rsi == null || momentum == null) {
    return { signal: null, tier: null, rsi, momentum };
  }
  if (!Number.isFinite(upPrice) || upPrice <= 0 || upPrice >= 1) {
    return { signal: null, tier: null, rsi, momentum };
  }

  // Tier 1: RSI + momentum + moderate cheap odds (relaxed from original 35/65/0.4/0.50)
  if (rsi < p.rsiBuyUpMax && momentum > p.minMomentumPct && upPrice < p.maxImpliedPrice) {
    return { signal: 'BUY_UP', tier: 'rsi_mom', rsi, momentum };
  }
  if (rsi > p.rsiBuyDownMin && momentum < -p.minMomentumPct && downPrice < p.maxImpliedPrice) {
    return { signal: 'BUY_DOWN', tier: 'rsi_mom', rsi, momentum };
  }

  // Tier 2: very cheap side + slight momentum alignment (snipe mispriced tails)
  if (upPrice < p.cheapImpliedMax && momentum > p.cheapMinMomentumPct) {
    return { signal: 'BUY_UP', tier: 'cheap_up', rsi, momentum };
  }
  if (downPrice < p.cheapImpliedMax && momentum < -p.cheapMinMomentumPct) {
    return { signal: 'BUY_DOWN', tier: 'cheap_down', rsi, momentum };
  }

  // Tier 3: strong momentum with coin-flip-ish odds (not paying 70c+)
  if (momentum > 0.22 && upPrice < 0.52) {
    return { signal: 'BUY_UP', tier: 'strong_mom_up', rsi, momentum };
  }
  if (momentum < -0.22 && downPrice < 0.52) {
    return { signal: 'BUY_DOWN', tier: 'strong_mom_down', rsi, momentum };
  }

  return { signal: null, tier: null, rsi, momentum };
}

export type ParentBtcSignalCache = SignalResult & { upPrice: number };

const parentSignalCache = new Map<string, ParentBtcSignalCache>();

export function clearParentSignalCache(): void {
  parentSignalCache.clear();
}

export function resolveUpPriceFromBooks(
  upBookMid: number | null | undefined,
  downBookMid: number | null | undefined,
): number | null {
  if (upBookMid != null && upBookMid > 0 && upBookMid < 1) return upBookMid;
  if (downBookMid != null && downBookMid > 0 && downBookMid < 1) return 1 - downBookMid;
  return null;
}

export function getOrComputeParentSignal(
  parentMarketId: string,
  closes: number[],
  upPrice: number,
  windowMinutes: 5 | 15,
  params: BtcSignalParams = {},
): ParentBtcSignalCache {
  const cached = parentSignalCache.get(parentMarketId);
  if (cached) return cached;

  const result = getAdvancedSignal(closes, upPrice, windowMinutes === 5 ? '5m' : '15m', params);
  const entry: ParentBtcSignalCache = { ...result, upPrice };
  parentSignalCache.set(parentMarketId, entry);
  return entry;
}

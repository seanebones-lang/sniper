import { rsiLast } from '@/lib/indicators/rsi';

export type BtcSniperSignal = 'BUY_UP' | 'BUY_DOWN' | null;

export type BtcSignalParams = {
  rsiPeriod?: number;
  rsiBuyUpMax?: number;
  rsiBuyDownMin?: number;
  minMomentumPct?: number;
  maxImpliedPrice?: number;
};

const DEFAULTS: Required<BtcSignalParams> = {
  rsiPeriod: 7,
  rsiBuyUpMax: 35,
  rsiBuyDownMin: 65,
  minMomentumPct: 0.4,
  maxImpliedPrice: 0.5,
};

export function computeMomentumPct(closes: number[], lookback = 5): number | null {
  if (closes.length < lookback + 1) return null;
  const prev = closes[closes.length - 1 - lookback];
  const last = closes[closes.length - 1];
  if (prev <= 0) return null;
  return ((last - prev) / prev) * 100;
}

export function getAdvancedSignal(
  closes: number[],
  upPrice: number,
  _marketType: '5m' | '15m',
  params: BtcSignalParams = {},
): BtcSniperSignal {
  const p = { ...DEFAULTS, ...params };
  const rsi = rsiLast(closes, p.rsiPeriod);
  const momentum = computeMomentumPct(closes, 5);
  if (rsi == null || momentum == null) return null;
  if (!Number.isFinite(upPrice) || upPrice <= 0 || upPrice >= 1) return null;

  if (rsi < p.rsiBuyUpMax && momentum > p.minMomentumPct && upPrice < p.maxImpliedPrice) {
    return 'BUY_UP';
  }
  if (rsi > p.rsiBuyDownMin && momentum < -p.minMomentumPct && 1 - upPrice < p.maxImpliedPrice) {
    return 'BUY_DOWN';
  }
  return null;
}

export type ParentBtcSignalCache = {
  signal: BtcSniperSignal;
  upPrice: number;
  rsi: number | null;
  momentum: number | null;
};

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

  const p = { ...DEFAULTS, ...params };
  const rsi = rsiLast(closes, p.rsiPeriod);
  const momentum = computeMomentumPct(closes, 5);
  const signal = getAdvancedSignal(closes, upPrice, windowMinutes === 5 ? '5m' : '15m', p);
  const entry: ParentBtcSignalCache = { signal, upPrice, rsi, momentum };
  parentSignalCache.set(parentMarketId, entry);
  return entry;
}

/**
 * BTC Sniper — async evaluate only (see evaluateBtcSniper).
 */

import {
  getOrComputeParentSignal,
  resolveUpPriceFromBooks,
  type BtcSignalParams,
} from '@/lib/btc/signal-engine';
import { isBtcUpDownMarket, parseBtcWindowMinutes } from '@/lib/markets/btc-sniper';
import type { Strategy, StrategySignal } from './types';
import type { CycleBookCache } from '@/lib/runner/book-cache';

let cycleBookCache: CycleBookCache | null = null;

export function setBtcSniperBookCache(cache: CycleBookCache | null): void {
  cycleBookCache = cache;
}

export const BtcSniper: Strategy = {
  id: 'btc-sniper',
  name: 'BTC Sniper',
  type: 'btc-sniper',
  evaluate: () => null,
};

export async function evaluateBtcSniper(
  ctx: Parameters<Strategy['evaluate']>[0],
  config: Parameters<Strategy['evaluate']>[1],
): Promise<StrategySignal | null> {
  const { fetchBtcUsdtCloses } = await import('@/lib/clients/ccxt-binance');
  const { market, book } = ctx;
  if (!book?.asks?.length) return null;
  if (!isBtcUpDownMarket(market)) return null;
  if (!market.outcome || !market.parentMarketId) return null;

  const windowMin = market.btcWindowMinutes ?? parseBtcWindowMinutes(market.question);
  if (windowMin !== 5 && windowMin !== 15) return null;

  const filter = config.btcWindowFilter ?? 'both';
  if (filter === '5' && windowMin !== 5) return null;
  if (filter === '15' && windowMin !== 15) return null;

  const ask = book.asks[0].price;
  const askSize = book.asks[0].size;
  if (ask <= 0 || ask >= 1) return null;

  const stakeUsd = config.maxSizeUsd ?? 1;
  const sharesNeeded = Math.max(1, Math.ceil(stakeUsd / ask));
  if (askSize < sharesNeeded) return null;

  const bid = book.bids?.[0]?.price ?? 0;
  const bidSize = book.bids?.[0]?.size ?? 0;
  // Micro: require any bid to exit; don't demand full share depth pre-entry
  if (bid <= 0 || bidSize < 1) return null;

  const closes = await fetchBtcUsdtCloses(30);
  if (!closes || closes.length < 8) return null;

  let upMid: number | null = null;
  let downMid: number | null = null;

  if (market.outcome === 'Up') {
    upMid = book.mid ?? ask;
    if (market.siblingTokenId && cycleBookCache) {
      const sib = cycleBookCache.getBook(market.platform, market.siblingTokenId);
      downMid = sib?.mid ?? sib?.asks?.[0]?.price ?? null;
    }
  } else {
    downMid = book.mid ?? ask;
    if (market.siblingTokenId && cycleBookCache) {
      const sib = cycleBookCache.getBook(market.platform, market.siblingTokenId);
      upMid = sib?.mid ?? sib?.asks?.[0]?.price ?? null;
    }
  }

  const upPrice = resolveUpPriceFromBooks(upMid, downMid);
  if (upPrice == null) return null;

  const signalParams: BtcSignalParams = {
    rsiPeriod: config.rsiPeriod ?? 7,
    rsiBuyUpMax: config.rsiBuyUpMax ?? 45,
    rsiBuyDownMin: config.rsiBuyDownMin ?? 55,
    minMomentumPct: config.minMomentumPct ?? 0.12,
    maxImpliedPrice: config.maxImpliedPrice ?? 0.58,
    cheapImpliedMax: config.cheapImpliedMax ?? 0.42,
    cheapMinMomentumPct: config.cheapMinMomentumPct ?? 0.04,
  };

  const parent = getOrComputeParentSignal(
    market.parentMarketId,
    closes,
    upPrice,
    windowMin,
    signalParams,
  );

  if (parent.signal === 'BUY_UP' && market.outcome !== 'Up') return null;
  if (parent.signal === 'BUY_DOWN' && market.outcome !== 'Down') return null;
  if (!parent.signal) return null;

  const targetPct = config.targetProfitPct ?? 8;
  const targetPrice = Math.min(0.99, ask * (1 + targetPct / 100));

  return {
    action: 'BUY',
    price: ask,
    size: sharesNeeded,
    reason: `BTC sniper ${parent.signal} [${parent.tier}] RSI=${parent.rsi?.toFixed(1) ?? '?'} mom=${parent.momentum?.toFixed(2) ?? '?'}% up=${upPrice.toFixed(3)} ${windowMin}m`,
    confidence: Math.min(0.88, 0.55 + Math.abs((parent.rsi ?? 50) - 50) / 100),
    edge: (targetPrice - ask) / ask,
  };
}

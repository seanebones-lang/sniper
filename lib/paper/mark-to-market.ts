import { fetchPolymarketPrice } from '@/lib/clients/polymarket';
import { fetchKalshiPrice } from '@/lib/clients/kalshi';
import type { PaperPositionRow } from './positions';

/** platform:marketExternalId → mid price */
export type MarkPriceMap = Map<string, number>;

export interface MarkToMarketResult {
  openCostBasisUsd: number;
  openMarkValueUsd: number;
  unrealizedPnLUsd: number;
  openPositionCount: number;
  positionsMarked: number;
  /** When marks were fetched (may be from cache) */
  markedAt: string;
  fromCache: boolean;
}

let mtmCache: {
  key: string;
  result: MarkToMarketResult;
  expiresAt: number;
} | null = null;

const MTM_CACHE_MS = 45_000;

function cacheKey(positions: PaperPositionRow[]): string {
  return positions
    .map((p) => `${p.platform}:${p.marketExternalId}:${p.netSize.toFixed(2)}:${p.avgPrice.toFixed(4)}`)
    .join('|');
}

async function markPosition(
  p: PaperPositionRow,
  markPrices?: MarkPriceMap,
): Promise<{ valueUsd: number; marked: boolean }> {
  const key = `${p.platform}:${p.marketExternalId}`;
  let mark: number | null | undefined = markPrices?.get(key);

  if (mark == null) {
    try {
      mark =
        p.platform === 'polymarket'
          ? await fetchPolymarketPrice(p.marketExternalId)
          : await fetchKalshiPrice(p.marketExternalId);
    } catch {
      return { valueUsd: p.notionalUsd, marked: false };
    }
  }

  if (mark == null || mark <= 0 || mark > 1) {
    return { valueUsd: p.notionalUsd, marked: false };
  }

  const valueUsd = Math.abs(p.netSize) * mark;
  return { valueUsd, marked: true };
}

/** Value open paper positions at live mid prices (falls back to cost when quote missing). */
export async function computeMarkToMarket(
  positions: PaperPositionRow[],
  markPrices?: MarkPriceMap,
): Promise<MarkToMarketResult> {
  const openCostBasisUsd = positions.reduce((sum, p) => sum + p.notionalUsd, 0);
  const key = cacheKey(positions);
  const now = Date.now();

  if (!markPrices && mtmCache && mtmCache.key === key && mtmCache.expiresAt > now) {
    return { ...mtmCache.result, fromCache: true };
  }

  if (positions.length === 0) {
    const empty: MarkToMarketResult = {
      openCostBasisUsd: 0,
      openMarkValueUsd: 0,
      unrealizedPnLUsd: 0,
      openPositionCount: 0,
      positionsMarked: 0,
      markedAt: new Date().toISOString(),
      fromCache: false,
    };
    return empty;
  }

  let openMarkValueUsd = 0;
  let positionsMarked = 0;
  const batchSize = 12;

  for (let i = 0; i < positions.length; i += batchSize) {
    const batch = positions.slice(i, i + batchSize);
    const results = await Promise.all(batch.map((p) => markPosition(p, markPrices)));
    for (const r of results) {
      openMarkValueUsd += r.valueUsd;
      if (r.marked) positionsMarked++;
    }
  }

  const result: MarkToMarketResult = {
    openCostBasisUsd,
    openMarkValueUsd,
    unrealizedPnLUsd: openMarkValueUsd - openCostBasisUsd,
    openPositionCount: positions.length,
    positionsMarked,
    markedAt: new Date().toISOString(),
    fromCache: false,
  };

  if (!markPrices) {
    mtmCache = { key, result, expiresAt: now + MTM_CACHE_MS };
  }
  return result;
}

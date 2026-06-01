/**
 * Unified market service (Phase 1)
 * Combines Polymarket + Kalshi with simple in-memory cache + deduping.
 */

import type { Market } from './types';
import { fetchPolymarketMarkets } from './clients/polymarket';
import { fetchKalshiMarkets } from './clients/kalshi';

let cachedMarkets: Market[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 25_000; // ~25s

export async function getAllMarkets(force = false): Promise<Market[]> {
  const now = Date.now();

  if (!force && cachedMarkets && now - lastFetch < CACHE_TTL) {
    return cachedMarkets;
  }

  const [poly, kalshi] = await Promise.allSettled([
    fetchPolymarketMarkets(60),
    fetchKalshiMarkets(60),
  ]);

  const polyMarkets = poly.status === 'fulfilled' ? poly.value : [];
  const kalshiMarkets = kalshi.status === 'fulfilled' ? kalshi.value : [];

  const combined = [...polyMarkets, ...kalshiMarkets]
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
    .slice(0, 100);

  cachedMarkets = combined;
  lastFetch = now;

  return combined;
}

export async function getMarket(platform: 'polymarket' | 'kalshi', externalId: string) {
  const all = await getAllMarkets();
  return all.find(m => m.platform === platform && m.externalId === externalId);
}

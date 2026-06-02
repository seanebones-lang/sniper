/**
 * Unified market service (Phase 1)
 * Combines Polymarket + Kalshi with simple in-memory cache + deduping.
 */

import type { Market } from './types';
import {
  fetchPolymarketMarkets,
  fetchPolymarketLiveSportsMarkets,
  fetchPolymarketMarketsResolvingWithinHours,
} from './clients/polymarket';
import {
  fetchKalshiMarkets,
  fetchKalshiMarketsClosingWithinHours,
} from './clients/kalshi';
import { ensureMarketRecord, ensureMarket } from './db/ensure-market';
import { QUICK_FLIP_MAX_RESOLUTION_HOURS } from './markets/fast-moving';

let cachedMarkets: Market[] | null = null;
let lastFetch = 0;
const CACHE_TTL = 25_000; // ~25s
const FETCH_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), FETCH_TIMEOUT_MS),
    ),
  ]);
}

export async function getAllMarkets(force = false): Promise<Market[]> {
  const now = Date.now();

  if (!force && cachedMarkets && now - lastFetch < CACHE_TTL) {
    return cachedMarkets;
  }

  const [poly, kalshi] = await Promise.allSettled([
    withTimeout(fetchPolymarketMarkets(60), 'Polymarket'),
    withTimeout(fetchKalshiMarkets(60), 'Kalshi'),
  ]);

  const polyMarkets = poly.status === 'fulfilled' ? poly.value : [];
  const kalshiMarkets = kalshi.status === 'fulfilled' ? kalshi.value : [];

  if (kalshi.status === 'rejected') {
    console.warn('[markets] Kalshi fetch failed (non-fatal):', kalshi.reason);
  }

  // Keep both platforms visible — Polymarket volume would otherwise crowd out Kalshi entirely.
  const sorted = [...polyMarkets, ...kalshiMarkets]
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));
  const polyTop = sorted.filter((m) => m.platform === 'polymarket').slice(0, 70);
  const kalshiTop = sorted.filter((m) => m.platform === 'kalshi').slice(0, 30);
  const combined = [...polyTop, ...kalshiTop]
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0));

  cachedMarkets = combined;
  lastFetch = now;

  return combined;
}

/** Near-term + live sports + leaderboard for quick-flip runner. */
export async function getMarketsForQuickFlip(force = false): Promise<Market[]> {
  const seen = new Set<string>();
  const merged: Market[] = [];

  const add = (m: Market) => {
    const key = `${m.platform}:${m.externalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(m);
  };

  // Primary: near-term window on Polymarket + Kalshi in parallel
  const [nearTermPoly, nearTermKalshi] = await Promise.allSettled([
    withTimeout(
      fetchPolymarketMarketsResolvingWithinHours(QUICK_FLIP_MAX_RESOLUTION_HOURS, 100),
      'Polymarket near-term',
    ),
    withTimeout(
      fetchKalshiMarketsClosingWithinHours(QUICK_FLIP_MAX_RESOLUTION_HOURS, 100),
      'Kalshi near-term',
    ),
  ]);

  if (nearTermPoly.status === 'fulfilled') {
    for (const m of nearTermPoly.value) add(m);
  } else {
    console.warn('[markets] Polymarket near-term fetch failed (non-fatal):', nearTermPoly.reason);
  }

  if (nearTermKalshi.status === 'fulfilled') {
    for (const m of nearTermKalshi.value) add(m);
  } else {
    console.warn('[markets] Kalshi near-term fetch failed (non-fatal):', nearTermKalshi.reason);
  }

  // Secondary: live sports search (tennis, in-play — may lack endDate on some rows)
  try {
    const liveSports = await withTimeout(fetchPolymarketLiveSportsMarkets(), 'Polymarket live sports');
    for (const m of liveSports) add(m);
  } catch (err) {
    console.warn('[markets] Live sports fetch failed (non-fatal):', err);
  }

  // Tertiary: volume leaderboard + Kalshi for breadth
  try {
    const base = await getAllMarkets(force);
    for (const m of base) add(m);
  } catch (err) {
    console.warn('[markets] Base market fetch failed (non-fatal):', err);
  }

  return merged;
}

export async function getMarket(platform: 'polymarket' | 'kalshi', externalId: string) {
  const all = await getAllMarkets();
  return all.find(m => m.platform === platform && m.externalId === externalId);
}

/**
 * Re-export the critical market persistence helpers.
 * These MUST be used before creating any Signal or Position that references a market.
 */
export { ensureMarketRecord, ensureMarket };

/**
 * Sync a batch of markets to the database (idempotent upsert).
 * Call this periodically or before heavy runner/signal activity.
 */
export async function syncMarketsToDb(markets: Market[]): Promise<string[]> {
  const ids: string[] = [];
  for (const m of markets) {
    try {
      const id = await ensureMarketRecord(m);
      ids.push(id);
    } catch (err) {
      console.warn(`[markets] Failed to sync market ${m.platform}:${m.externalId}`, err);
    }
  }
  return ids;
}

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
import { ensureMarketRecord, ensureMarket, ensureMarketRecordsBatch } from './db/ensure-market';
import { QUICK_FLIP_MAX_RESOLUTION_HOURS, LIVE_MAX_RESOLUTION_HOURS, filterLiveResolutionMarkets } from './markets/fast-moving';
import { fetchBtcMarketsBySlug } from './clients/polymarket-btc-slug';
import {
  fetchPolymarketBtcNearTermMarkets,
  fetchPolymarketBtcUpDownSearchMarkets,
} from './clients/polymarket-btc-markets';
import {
  dedupeMarketsByToken,
  filterBtcSniperMarkets,
  rankBtcSniperMarkets,
  summarizeBtcPool,
} from './markets/btc-sniper';

let cachedMarkets: Market[] | null = null;
let lastFetch = 0;
let cachedQuickFlip: Market[] | null = null;
let lastQuickFlipFetch = 0;
let cachedLiveNearTerm: Market[] | null = null;
let lastLiveNearTermFetch = 0;
let cachedBtcSniper: Market[] | null = null;
let lastBtcSniperFetch = 0;
const BTC_SNIPER_CACHE_TTL = 12_000;
const LIVE_NEAR_TERM_CACHE_TTL = 20_000;
const CACHE_TTL = 25_000; // ~25s
const QUICK_FLIP_CACHE_TTL = 20_000; // refresh fast markets slightly faster
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
  const now = Date.now();
  if (!force && cachedQuickFlip && now - lastQuickFlipFetch < QUICK_FLIP_CACHE_TTL) {
    return cachedQuickFlip;
  }

  const seen = new Set<string>();
  const merged: Market[] = [];

  const add = (m: Market) => {
    const key = `${m.platform}:${m.externalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(m);
  };

  const liveOnly = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';

  // All sources are independent — fetch in parallel, then merge in priority
  // order (near-term poly → near-term kalshi → live sports → leaderboard) so
  // dedupe keeps the same winners as the old sequential code.
  const [nearTermPoly, nearTermKalshi, liveSports, base] = await Promise.allSettled([
    // Primary: near-term Polymarket (Kalshi skipped on live — 429s slow the runner)
    withTimeout(
      fetchPolymarketMarketsResolvingWithinHours(QUICK_FLIP_MAX_RESOLUTION_HOURS, 100),
      'Polymarket near-term',
    ),
    liveOnly
      ? Promise.resolve<Market[]>([])
      : withTimeout(
          fetchKalshiMarketsClosingWithinHours(QUICK_FLIP_MAX_RESOLUTION_HOURS, 100),
          'Kalshi near-term',
        ),
    // Secondary: live sports search (tennis, in-play — may lack endDate on some rows)
    withTimeout(fetchPolymarketLiveSportsMarkets(), 'Polymarket live sports'),
    // Tertiary: volume leaderboard (skip on live micro runner — saves ~15s/cycle)
    liveOnly ? Promise.resolve<Market[]>([]) : getAllMarkets(force),
  ]);

  for (const [result, label] of [
    [nearTermPoly, 'Polymarket near-term'],
    [nearTermKalshi, 'Kalshi near-term'],
    [liveSports, 'Live sports'],
    [base, 'Base market'],
  ] as const) {
    if (result.status === 'fulfilled') {
      for (const m of result.value) add(m);
    } else {
      console.warn(`[markets] ${label} fetch failed (non-fatal):`, result.reason);
    }
  }

  cachedQuickFlip = merged;
  lastQuickFlipFetch = Date.now();
  return merged;
}

/** Live runner pool: markets resolving within LIVE_MAX_RESOLUTION_HOURS (24h). */
export async function getMarketsForLiveNearTerm(force = false): Promise<Market[]> {
  const now = Date.now();
  if (!force && cachedLiveNearTerm && now - lastLiveNearTermFetch < LIVE_NEAR_TERM_CACHE_TTL) {
    return cachedLiveNearTerm;
  }

  const seen = new Set<string>();
  const merged: Market[] = [];

  const add = (m: Market) => {
    const key = `${m.platform}:${m.externalId}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(m);
  };

  const [nearTermPoly, liveSports] = await Promise.allSettled([
    withTimeout(
      fetchPolymarketMarketsResolvingWithinHours(LIVE_MAX_RESOLUTION_HOURS, 120),
      'Polymarket 24h near-term',
    ),
    withTimeout(fetchPolymarketLiveSportsMarkets(), 'Polymarket live sports'),
  ]);

  if (nearTermPoly.status === 'fulfilled') {
    for (const m of nearTermPoly.value) add(m);
  } else {
    console.warn('[markets] Polymarket 24h near-term fetch failed (non-fatal):', nearTermPoly.reason);
  }
  if (liveSports.status === 'fulfilled') {
    for (const m of liveSports.value) add(m);
  } else {
    console.warn('[markets] Live sports fetch failed (non-fatal):', liveSports.reason);
  }

  cachedLiveNearTerm = filterLiveResolutionMarkets(merged);
  lastLiveNearTermFetch = Date.now();
  return cachedLiveNearTerm;
}

/** BTC Up/Down 5m/15m pool — slug-first, search + near-term fallbacks. */
export async function getMarketsForBtcSniper(force = false): Promise<Market[]> {
  const now = Date.now();
  if (!force && cachedBtcSniper && now - lastBtcSniperFetch < BTC_SNIPER_CACHE_TTL) {
    return cachedBtcSniper;
  }

  const merged: Market[] = [];

  const [slugResults, nearTerm, search] = await Promise.allSettled([
    withTimeout(fetchBtcMarketsBySlug(now), 'BTC slug markets'),
    withTimeout(fetchPolymarketBtcNearTermMarkets(2, 200), 'BTC near-term'),
    withTimeout(fetchPolymarketBtcUpDownSearchMarkets(), 'BTC search'),
  ]);

  if (slugResults.status === 'fulfilled') {
    for (const r of slugResults.value) merged.push(...r.markets);
  } else {
    console.warn('[markets] BTC slug fetch failed (non-fatal):', slugResults.reason);
  }
  if (nearTerm.status === 'fulfilled') {
    merged.push(...nearTerm.value);
  } else {
    console.warn('[markets] BTC near-term fetch failed (non-fatal):', nearTerm.reason);
  }
  if (search.status === 'fulfilled') {
    merged.push(...search.value);
  } else {
    console.warn('[markets] BTC search fetch failed (non-fatal):', search.reason);
  }

  const deduped = dedupeMarketsByToken(merged);
  const filtered = filterBtcSniperMarkets(deduped, now);
  cachedBtcSniper = rankBtcSniperMarkets(filtered);
  lastBtcSniperFetch = Date.now();

  const summary = summarizeBtcPool(cachedBtcSniper);
  console.log(
    `[markets] BTC sniper pool: ${summary.poolTotal} tokens (${summary.parentMarkets} parents, 5m=${summary.windows5m}, 15m=${summary.windows15m})`,
  );

  return cachedBtcSniper;
}

export { summarizeBtcPool };

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
 * Uses a chunked multi-row upsert — one statement per ~100 markets instead of
 * one round-trip per market.
 */
export async function syncMarketsToDb(markets: Market[]): Promise<Map<string, string>> {
  return ensureMarketRecordsBatch(markets);
}

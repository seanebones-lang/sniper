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

  // Primary: near-term Polymarket (Kalshi skipped on live — 429s slow the runner)
  try {
    const nearTermPoly = await withTimeout(
      fetchPolymarketMarketsResolvingWithinHours(QUICK_FLIP_MAX_RESOLUTION_HOURS, 100),
      'Polymarket near-term',
    );
    for (const m of nearTermPoly) add(m);
  } catch (err) {
    console.warn('[markets] Polymarket near-term fetch failed (non-fatal):', err);
  }

  if (!liveOnly) {
    try {
      const nearTermKalshi = await withTimeout(
        fetchKalshiMarketsClosingWithinHours(QUICK_FLIP_MAX_RESOLUTION_HOURS, 100),
        'Kalshi near-term',
      );
      for (const m of nearTermKalshi) add(m);
    } catch (err) {
      console.warn('[markets] Kalshi near-term fetch failed (non-fatal):', err);
    }
  }

  // Secondary: live sports search (tennis, in-play — may lack endDate on some rows)
  try {
    const liveSports = await withTimeout(fetchPolymarketLiveSportsMarkets(), 'Polymarket live sports');
    for (const m of liveSports) add(m);
  } catch (err) {
    console.warn('[markets] Live sports fetch failed (non-fatal):', err);
  }

  // Tertiary: volume leaderboard (skip on live micro runner — saves ~15s/cycle)
  if (!liveOnly) {
    try {
      const base = await getAllMarkets(force);
      for (const m of base) add(m);
    } catch (err) {
      console.warn('[markets] Base market fetch failed (non-fatal):', err);
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

  try {
    const nearTermPoly = await withTimeout(
      fetchPolymarketMarketsResolvingWithinHours(LIVE_MAX_RESOLUTION_HOURS, 120),
      'Polymarket 24h near-term',
    );
    for (const m of nearTermPoly) add(m);
  } catch (err) {
    console.warn('[markets] Polymarket 24h near-term fetch failed (non-fatal):', err);
  }

  try {
    const liveSports = await withTimeout(fetchPolymarketLiveSportsMarkets(), 'Polymarket live sports');
    for (const m of liveSports) add(m);
  } catch (err) {
    console.warn('[markets] Live sports fetch failed (non-fatal):', err);
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

  try {
    const slugResults = await withTimeout(fetchBtcMarketsBySlug(now), 'BTC slug markets');
    for (const r of slugResults) merged.push(...r.markets);
  } catch (err) {
    console.warn('[markets] BTC slug fetch failed (non-fatal):', err);
  }

  try {
    const nearTerm = await withTimeout(fetchPolymarketBtcNearTermMarkets(2, 200), 'BTC near-term');
    merged.push(...nearTerm);
  } catch (err) {
    console.warn('[markets] BTC near-term fetch failed (non-fatal):', err);
  }

  try {
    const search = await withTimeout(fetchPolymarketBtcUpDownSearchMarkets(), 'BTC search');
    merged.push(...search);
  } catch (err) {
    console.warn('[markets] BTC search fetch failed (non-fatal):', err);
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
 */
export async function syncMarketsToDb(
  markets: Market[],
  concurrency = 12,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (let i = 0; i < markets.length; i += concurrency) {
    const batch = markets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (m) => {
        const key = `${m.platform}:${m.externalId}`;
        try {
          const id = await ensureMarketRecord(m);
          ids.set(key, id);
        } catch (err) {
          console.warn(`[markets] Failed to sync market ${m.platform}:${m.externalId}`, err);
        }
      }),
    );
  }
  return ids;
}

/**
 * Deterministic Polymarket BTC Up/Down market discovery via slug.
 * Format: btc-updown-{5|15}m-{unix_timestamp} (UTC window start, floored to interval).
 */

import type { GammaMarket } from './polymarket';
import { gammaMarketToBtcMarkets } from './polymarket-btc-markets';
import type { Market } from '../types';
import { getErrorMessage } from '../error-message';

const GAMMA_API = 'https://gamma-api.polymarket.com';

export type BtcWindowInterval = 5 | 15;

export function getBtcUpDownSlug(intervalMinutes: BtcWindowInterval, atMs = Date.now()): string {
  const intervalSec = intervalMinutes * 60;
  const windowStartTs = Math.floor(atMs / 1000 / intervalSec) * intervalSec;
  return `btc-updown-${intervalMinutes}m-${windowStartTs}`;
}

export function getNextBtcUpDownSlug(intervalMinutes: BtcWindowInterval, atMs = Date.now()): string {
  const intervalSec = intervalMinutes * 60;
  const windowStartTs = Math.floor(atMs / 1000 / intervalSec) * intervalSec + intervalSec;
  return `btc-updown-${intervalMinutes}m-${windowStartTs}`;
}

export async function fetchGammaMarketBySlug(slug: string): Promise<GammaMarket | null> {
  const url = `${GAMMA_API}/markets/slug/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, { next: { revalidate: 5 } });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`[Polymarket BTC] slug fetch ${slug}: HTTP ${res.status}`);
      return null;
    }
    const data = (await res.json()) as GammaMarket | GammaMarket[];
    if (Array.isArray(data)) return data[0] ?? null;
    return data;
  } catch (err) {
    console.warn(`[Polymarket BTC] slug fetch failed ${slug}:`, getErrorMessage(err));
    return null;
  }
}

export type SlugFetchResult = {
  slug: string;
  intervalMinutes: BtcWindowInterval;
  markets: Market[];
  source: 'slug';
};

/** Fetch current + next window for 5m and 15m (up to 4 slug calls, parallel). */
export async function fetchBtcMarketsBySlug(atMs = Date.now()): Promise<SlugFetchResult[]> {
  const specs: Array<{ slug: string; intervalMinutes: BtcWindowInterval }> = [];
  for (const interval of [5, 15] as const) {
    specs.push({ slug: getBtcUpDownSlug(interval, atMs), intervalMinutes: interval });
    specs.push({ slug: getNextBtcUpDownSlug(interval, atMs), intervalMinutes: interval });
  }

  const results = await Promise.all(
    specs.map(async ({ slug, intervalMinutes }) => {
      const gamma = await fetchGammaMarketBySlug(slug);
      if (!gamma) return null;
      const markets = gammaMarketToBtcMarkets(gamma, intervalMinutes);
      if (markets.length === 0) return null;
      return { slug, intervalMinutes, markets, source: 'slug' as const };
    }),
  );

  return results.filter((r): r is SlugFetchResult => r != null);
}

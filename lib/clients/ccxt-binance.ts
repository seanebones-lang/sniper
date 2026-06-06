/**
 * Binance BTC/USDT 1m candles — equivalent to ccxt fetchOHLCV('BTC/USDT', '1m').
 * Uses Binance public data API (no keys, server-side only).
 */

import { getErrorMessage } from '../error-message';

const KLINES_URLS = [
  'https://data-api.binance.vision/api/v3/klines',
  'https://api.binance.com/api/v3/klines',
];

let cachedCloses: { at: number; closes: number[] } | null = null;
const CACHE_TTL_MS = 20_000;

async function fetchKlinesFromUrl(
  baseUrl: string,
  limit: number,
): Promise<number[] | null> {
  const url = `${baseUrl}?symbol=BTCUSDT&interval=1m&limit=${limit}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as Array<[number, string, string, string, string, string]>;
  const closes = data.map((row) => parseFloat(row[4])).filter((c) => c > 0);
  return closes.length >= 8 ? closes : null;
}

export async function fetchBtcUsdtCloses(
  limit = 30,
  force = false,
): Promise<number[] | null> {
  const now = Date.now();
  if (!force && cachedCloses && now - cachedCloses.at < CACHE_TTL_MS) {
    return cachedCloses.closes;
  }

  for (const baseUrl of KLINES_URLS) {
    try {
      const closes = await fetchKlinesFromUrl(baseUrl, limit);
      if (closes) {
        cachedCloses = { at: now, closes };
        return closes;
      }
    } catch (err) {
      console.warn(`[Binance] klines failed (${baseUrl}):`, getErrorMessage(err));
    }
  }

  return cachedCloses?.closes ?? null;
}

export function clearBtcCandleCache(): void {
  cachedCloses = null;
}

/**
 * BTC/USD 1-minute closes for the BTC sniper signal — resilient multi-venue fetch.
 *
 * Binance is the primary source, but its public API returns HTTP 451 from
 * US-hosted regions (e.g. Railway US). With only Binance URLs the sniper would
 * silently receive `null` closes every cycle and never emit a signal in either
 * paper or live mode. We fall back to Coinbase and Kraken (both reachable from
 * the US) so momentum/RSI keeps working regardless of deploy region. Closes are
 * normalized oldest→newest across every source.
 */

import { getErrorMessage } from '../error-message';

const CACHE_TTL_MS = 20_000;
const FETCH_TIMEOUT_MS = 4_000;
const MIN_CLOSES = 8;

let cachedCloses: { at: number; closes: number[]; source: string } | null = null;

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'sniper/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeCloses(values: number[], limit: number): number[] | null {
  const closes = values.filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < MIN_CLOSES) return null;
  return closes.slice(-limit);
}

async function fetchBinanceKlines(baseUrl: string, limit: number): Promise<number[] | null> {
  const data = await fetchJson(`${baseUrl}?symbol=BTCUSDT&interval=1m&limit=${limit}`);
  if (!Array.isArray(data)) return null;
  // Binance klines are oldest→newest; close is index 4 (string).
  return sanitizeCloses(
    data.map((row) => parseFloat((row as string[])[4])),
    limit,
  );
}

async function fetchCoinbaseCandles(limit: number): Promise<number[] | null> {
  // Coinbase Exchange returns [time, low, high, open, close, volume], newest→oldest.
  const data = await fetchJson(
    'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60',
  );
  if (!Array.isArray(data)) return null;
  const ascending = [...data].reverse();
  return sanitizeCloses(
    ascending.map((row) => Number((row as number[])[4])),
    limit,
  );
}

async function fetchKrakenOhlc(limit: number): Promise<number[] | null> {
  // Kraken returns { result: { <pair>: [[time, o, h, l, c, ...], ...], last } }, oldest→newest.
  const data = (await fetchJson(
    'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1',
  )) as { result?: Record<string, unknown> } | null;
  const result = data?.result;
  if (!result || typeof result !== 'object') return null;
  const rows = Object.entries(result).find(([k]) => k !== 'last')?.[1];
  if (!Array.isArray(rows)) return null;
  // Kraken close is index 4 (string).
  return sanitizeCloses(
    rows.map((row) => parseFloat((row as string[])[4])),
    limit,
  );
}

const SOURCES: Array<{ name: string; fetch: (limit: number) => Promise<number[] | null> }> = [
  {
    name: 'binance-vision',
    fetch: (l) => fetchBinanceKlines('https://data-api.binance.vision/api/v3/klines', l),
  },
  {
    name: 'binance-com',
    fetch: (l) => fetchBinanceKlines('https://api.binance.com/api/v3/klines', l),
  },
  { name: 'coinbase', fetch: fetchCoinbaseCandles },
  { name: 'kraken', fetch: fetchKrakenOhlc },
];

/**
 * Fetch recent BTC 1m closes (oldest→newest). Tries each venue in order and
 * caches the first success for `CACHE_TTL_MS`. Returns the last good closes if
 * every venue fails on this call so a transient blip doesn't kill the strategy.
 */
export async function fetchBtcUsdtCloses(
  limit = 30,
  force = false,
): Promise<number[] | null> {
  const now = Date.now();
  if (!force && cachedCloses && now - cachedCloses.at < CACHE_TTL_MS) {
    return cachedCloses.closes;
  }

  for (const source of SOURCES) {
    try {
      const closes = await source.fetch(limit);
      if (closes) {
        const prevSource = cachedCloses?.source;
        cachedCloses = { at: now, closes, source: source.name };
        if (prevSource !== source.name) {
          console.log(`[BTC candles] source=${source.name} (${closes.length} closes)`);
        }
        return closes;
      }
    } catch (err) {
      console.warn(`[BTC candles] ${source.name} failed:`, getErrorMessage(err));
    }
  }

  return cachedCloses?.closes ?? null;
}

export function clearBtcCandleCache(): void {
  cachedCloses = null;
}

/** Which venue served the last cached closes (diagnostics / health). */
export function getBtcCandleSource(): string | null {
  return cachedCloses?.source ?? null;
}

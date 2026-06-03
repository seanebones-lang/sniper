/**
 * Polymarket geoblock check (https://polymarket.com/api/geoblock).
 * Uses the server's egress IP — deploy in a non-restricted region (e.g. eu-west-1) for live trading.
 */

import { getPolymarketFetchInit, ensurePolymarketProxyConfigured } from '@/lib/clients/polymarket-http-proxy';

const GEOBLOCK_URL = 'https://polymarket.com/api/geoblock';
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface PolymarketGeoblockResult {
  blocked: boolean;
  country?: string;
  region?: string;
  ip?: string;
  checkedAt: string;
  error?: string;
  /** When true, do not call the API (dev override only). */
  skipped?: boolean;
}

let cached: PolymarketGeoblockResult | null = null;
let cachedAt = 0;

export async function checkPolymarketGeoblock(options?: {
  force?: boolean;
  /** When true, always call the API (orders/status). SNIPER_SKIP_GEOBLOCK_CHECK only relaxes runner warnings. */
  ignoreSkip?: boolean;
}): Promise<PolymarketGeoblockResult> {
  if (
    process.env.SNIPER_SKIP_GEOBLOCK_CHECK === 'true' &&
    options?.ignoreSkip !== true
  ) {
    return {
      blocked: false,
      checkedAt: new Date().toISOString(),
      skipped: true,
    };
  }

  const now = Date.now();
  if (!options?.force && cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }

  try {
    await ensurePolymarketProxyConfigured();
    const res = await fetch(GEOBLOCK_URL, {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
      ...(await getPolymarketFetchInit()),
    });
    if (!res.ok) {
      const result: PolymarketGeoblockResult = {
        blocked: false,
        checkedAt: new Date().toISOString(),
        error: `Geoblock API HTTP ${res.status}`,
      };
      cached = result;
      cachedAt = now;
      return result;
    }
    const data = (await res.json()) as {
      blocked?: boolean;
      country?: string;
      region?: string;
      ip?: string;
    };
    const result: PolymarketGeoblockResult = {
      blocked: Boolean(data.blocked),
      country: data.country,
      region: data.region,
      ip: data.ip,
      checkedAt: new Date().toISOString(),
    };
    cached = result;
    cachedAt = now;
    return result;
  } catch (err) {
    const result: PolymarketGeoblockResult = {
      blocked: false,
      checkedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
    cached = result;
    cachedAt = now;
    return result;
  }
}

export function formatGeoblockMessage(geo: PolymarketGeoblockResult): string {
  if (geo.skipped) {
    return 'Geoblock pre-check skipped (SNIPER_SKIP_GEOBLOCK_CHECK) — CLOB still enforces region on every order';
  }
  if (geo.error) return `Geoblock check unavailable: ${geo.error}`;
  if (!geo.blocked) return 'Trading allowed for this server IP';
  const loc = [geo.region, geo.country].filter(Boolean).join(', ') || 'your region';
  return `Polymarket blocks trading from this server (${loc}). Run Sniper with egress in a non-blocked region (e.g. AWS eu-west-1) or Polymarket co-location — VPN/proxy must match an allowed country.`;
}

/** CLOB post-order body when geoblocked or rejected (no order id). */
export function isPolymarketGeoblockOrderError(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const r = response as Record<string, unknown>;
  const err = String(r.error ?? r.errorMsg ?? '').toLowerCase();
  const status = r.status;
  return (
    status === 403 ||
    err.includes('restricted in your region') ||
    err.includes('geoblock')
  );
}

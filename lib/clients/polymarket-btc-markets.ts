/**
 * BTC Up/Down market parsing — dual Up + Down token rows from Gamma.
 */

import type { Market } from '../types';
import type { GammaMarket } from './polymarket';
import { getErrorMessage } from '../error-message';

const GAMMA_API = 'https://gamma-api.polymarket.com';

export const BTC_UP_DOWN_SEARCH_QUERIES = [
  'bitcoin up or down',
  'bitcoin 5 minute',
  'bitcoin 15 minute',
];

function parseGammaArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeOutcomeLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** Emit Up + Down tradeable rows from one Gamma binary market. */
export function gammaMarketToBtcMarkets(
  m: GammaMarket,
  btcWindowMinutes?: 5 | 15,
): Market[] {
  if (!m.active || m.closed || m.archived) return [];

  const clobTokenIds = parseGammaArray<string>(m.clobTokenIds);
  const outcomes = parseGammaArray<string>(m.outcomes);
  const outcomePrices = parseGammaArray<string>(m.outcomePrices);

  if (clobTokenIds.length < 2) return [];

  const upIdx = outcomes.findIndex((o) => normalizeOutcomeLabel(o) === 'up');
  const downIdx = outcomes.findIndex((o) => normalizeOutcomeLabel(o) === 'down');
  if (upIdx < 0 || downIdx < 0) return [];

  const upToken = clobTokenIds[upIdx];
  const downToken = clobTokenIds[downIdx];
  if (!upToken || !downToken) return [];

  const upPriceRaw = outcomePrices[upIdx];
  const downPriceRaw = outcomePrices[downIdx];
  const upPrice = upPriceRaw != null ? parseFloat(upPriceRaw) : undefined;
  const downPrice = downPriceRaw != null ? parseFloat(downPriceRaw) : undefined;

  const base = {
    id: m.id,
    platform: 'polymarket' as const,
    question: m.question,
    status: m.closed ? ('closed' as const) : ('open' as const),
    volume: m.volumeNum ?? 0,
    liquidity: m.liquidityNum ?? 0,
    updatedAt: new Date().toISOString(),
    endDate: m.endDate,
    volume24hr: m.volume24hr,
    parentMarketId: m.id,
    btcWindowMinutes,
  };

  return [
    {
      ...base,
      externalId: upToken,
      outcome: 'Up',
      siblingTokenId: downToken,
      lastPrice: upPrice != null && !Number.isNaN(upPrice) ? upPrice : undefined,
    },
    {
      ...base,
      externalId: downToken,
      outcome: 'Down',
      siblingTokenId: upToken,
      lastPrice: downPrice != null && !Number.isNaN(downPrice) ? downPrice : undefined,
    },
  ];
}

export async function fetchPolymarketBtcUpDownSearchMarkets(): Promise<Market[]> {
  const seen = new Set<string>();
  const results: Market[] = [];

  await Promise.all(
    BTC_UP_DOWN_SEARCH_QUERIES.map(async (query) => {
      const url = `${GAMMA_API}/public-search?q=${encodeURIComponent(query)}&limit_per_type=25&events_status=active`;
      try {
        const res = await fetch(url, { next: { revalidate: 15 } });
        if (!res.ok) return;
        const data = (await res.json()) as { events?: Array<{ markets?: GammaMarket[] }> };
        for (const event of data.events ?? []) {
          for (const m of event.markets ?? []) {
            for (const row of gammaMarketToBtcMarkets(m)) {
              const key = `${row.platform}:${row.externalId}`;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push(row);
            }
          }
        }
      } catch (err) {
        console.warn(`[Polymarket BTC] search failed for "${query}":`, getErrorMessage(err));
      }
    }),
  );

  return results;
}

/** Near-term markets ordered by soonest endDate — fallback if slug format changes. */
export async function fetchPolymarketBtcNearTermMarkets(hours = 2, limit = 200): Promise<Market[]> {
  const now = new Date();
  const maxEnd = new Date(now.getTime() + hours * 3600 * 1000);
  const params = new URLSearchParams({
    limit: String(limit),
    active: 'true',
    closed: 'false',
    archived: 'false',
    end_date_min: now.toISOString(),
    end_date_max: maxEnd.toISOString(),
    order: 'endDate',
    ascending: 'true',
  });

  const url = `${GAMMA_API}/markets?${params.toString()}`;
  try {
    const res = await fetch(url, { next: { revalidate: 15 } });
    if (!res.ok) return [];
    const data = (await res.json()) as GammaMarket[];
    const out: Market[] = [];
    for (const m of data) {
      const q = m.question ?? '';
      if (!/bitcoin|btc/i.test(q) || !/up or down/i.test(q)) continue;
      out.push(...gammaMarketToBtcMarkets(m));
    }
    return out;
  } catch (err) {
    console.warn('[Polymarket BTC] near-term fetch failed:', getErrorMessage(err));
    return [];
  }
}

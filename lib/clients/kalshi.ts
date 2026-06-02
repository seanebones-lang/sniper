/**
 * Kalshi thin client (public market data only for Phase 1)
 * Uses direct fetch against external-api (no auth required for public reads).
 */

import type { Market, OrderBook, OrderBookLevel } from '../types';
import { normalizeOrderBookLevels } from '../orderbook';

const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';

export interface KalshiMarket {
  ticker: string;
  event_ticker: string;
  series_ticker: string;
  title: string;
  yes_bid?: number | null;
  yes_ask?: number | null;
  no_bid?: number | null;
  no_ask?: number | null;
  yes_bid_dollars?: string | null;
  yes_ask_dollars?: string | null;
  last_price?: number | null;
  last_price_dollars?: string | null;
  volume?: number;
  volume_24h?: number;
  open_interest?: number;
  status: 'open' | 'closed' | 'settled';
  close_time?: string;
  expected_expiration_time?: string;
  expiration_time?: string;
}

type DollarLevel = [string, string];

/** Parse Kalshi orderbook_fp: yes_dollars = YES bids, NO bids imply YES asks at (1 - no_price). */
export function parseKalshiOrderBookPayload(json: {
  orderbook?: { yes?: { bids?: [number, number][]; asks?: [number, number][] } };
  orderbook_fp?: { yes_dollars?: DollarLevel[]; no_dollars?: DollarLevel[] };
}): { bids: OrderBookLevel[]; asks: OrderBookLevel[] } {
  const fp = json.orderbook_fp;
  if (fp) {
    const yesBids: OrderBookLevel[] = (fp.yes_dollars ?? []).map(([price, size]) => ({
      price: parseFloat(price),
      size: parseFloat(size),
    })).filter((l) => l.price > 0 && l.size > 0);

    const yesAsks: OrderBookLevel[] = (fp.no_dollars ?? []).map(([noPrice, size]) => ({
      price: Math.max(0.01, Math.min(0.99, 1 - parseFloat(noPrice))),
      size: parseFloat(size),
    })).filter((l) => l.price > 0 && l.size > 0);

    return {
      bids: yesBids.sort((a, b) => b.price - a.price),
      asks: yesAsks.sort((a, b) => a.price - b.price),
    };
  }

  const legacy = json.orderbook?.yes;
  const yesBids: OrderBookLevel[] = (legacy?.bids ?? []).map(([price, size]) => ({
    price: price / 100,
    size,
  }));
  const yesAsks: OrderBookLevel[] = (legacy?.asks ?? []).map(([price, size]) => ({
    price: price / 100,
    size,
  }));

  return { bids: yesBids, asks: yesAsks };
}

function kalshiMarketToMarket(m: KalshiMarket): Market {
  const yesBid = m.yes_bid_dollars != null
    ? parseFloat(m.yes_bid_dollars)
    : m.yes_bid != null ? m.yes_bid / 100 : undefined;
  const yesAsk = m.yes_ask_dollars != null
    ? parseFloat(m.yes_ask_dollars)
    : m.yes_ask != null ? m.yes_ask / 100 : undefined;
  const lastPrice = m.last_price_dollars != null
    ? parseFloat(m.last_price_dollars)
    : m.last_price != null ? m.last_price / 100 : undefined;

  const resolvedEnd =
    m.close_time ?? m.expected_expiration_time ?? m.expiration_time;

  return {
    id: m.ticker,
    platform: 'kalshi',
    externalId: m.ticker,
    question: m.title,
    status: m.status === 'open' ? 'open' : 'closed',
    volume: m.volume ?? m.volume_24h ?? 0,
    liquidity: (yesBid ?? 0) + (yesAsk ?? 0) > 0
      ? ((yesBid ?? 0) + (yesAsk ?? 0)) * 1000
      : m.open_interest ?? 0,
    lastPrice: lastPrice ?? (yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 2 : yesBid ?? yesAsk),
    updatedAt: new Date().toISOString(),
    endDate: resolvedEnd,
  };
}

async function fetchKalshiMarketRows(params: Record<string, string>): Promise<KalshiMarket[]> {
  const query = new URLSearchParams({ status: 'open', ...params });
  const url = `${KALSHI_BASE}/markets?${query.toString()}`;
  const res = await fetch(url, { next: { revalidate: 20 } });

  if (!res.ok) {
    throw new Error(`Kalshi markets error: ${res.status}`);
  }

  const json = await res.json();
  return (json.markets ?? []) as KalshiMarket[];
}

export async function fetchKalshiMarkets(limit = 50): Promise<Market[]> {
  const markets = await fetchKalshiMarketRows({ limit: String(limit) });
  return markets.slice(0, limit).map(kalshiMarketToMarket);
}

/** Markets with close_time in (now, now + hours] — Kalshi's equivalent of Polymarket near-term window. */
export async function fetchKalshiMarketsClosingWithinHours(
  hours: number,
  limit = 100,
): Promise<Market[]> {
  const nowSec = Math.floor(Date.now() / 1000);
  const maxSec = nowSec + hours * 3600;
  const markets = await fetchKalshiMarketRows({
    limit: String(limit),
    min_close_ts: String(nowSec),
    max_close_ts: String(maxSec),
  });
  return markets.slice(0, limit).map(kalshiMarketToMarket);
}

export async function fetchKalshiOrderBook(ticker: string): Promise<OrderBook> {
  const url = `${KALSHI_BASE}/markets/${ticker}/orderbook`;
  const res = await fetch(url, { next: { revalidate: 5 } });

  if (!res.ok) {
    throw new Error(`Kalshi orderbook error for ${ticker}: ${res.status}`);
  }

  const json = await res.json();
  const { bids, asks } = parseKalshiOrderBookPayload(json);
  const { bids: sortedBids, asks: sortedAsks, mid, spread } = normalizeOrderBookLevels(bids, asks);

  return {
    platform: 'kalshi',
    marketExternalId: ticker,
    bids: sortedBids,
    asks: sortedAsks,
    mid,
    spread,
    timestamp: new Date().toISOString(),
  };
}

export async function fetchKalshiPrice(ticker: string): Promise<number | null> {
  try {
    const book = await fetchKalshiOrderBook(ticker);
    return book.mid ?? (book.bids[0]?.price ?? book.asks[0]?.price ?? null);
  } catch {
    return null;
  }
}

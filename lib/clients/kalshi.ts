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
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  last_price: number;
  volume: number;
  open_interest: number;
  status: 'open' | 'closed' | 'settled';
  expiration_time: string;
}

export async function fetchKalshiMarkets(limit = 50): Promise<Market[]> {
  const url = `${KALSHI_BASE}/markets?status=open&limit=${limit}`;
  const res = await fetch(url, { next: { revalidate: 30 } });

  if (!res.ok) {
    throw new Error(`Kalshi markets error: ${res.status}`);
  }

  const json = await res.json();
  const markets: KalshiMarket[] = json.markets ?? [];

  return markets.slice(0, limit).map((m): Market => ({
    id: m.ticker,
    platform: 'kalshi',
    externalId: m.ticker,
    question: m.title,
    status: m.status === 'open' ? 'open' : 'closed',
    volume: m.volume,
    liquidity: (m.yes_bid + m.yes_ask + m.no_bid + m.no_ask) * 100, // rough proxy
    lastPrice: m.last_price ? m.last_price / 100 : undefined, // Kalshi uses cents (0-100)
    updatedAt: new Date().toISOString(),
  }));
}

export async function fetchKalshiOrderBook(ticker: string): Promise<OrderBook> {
  const url = `${KALSHI_BASE}/markets/${ticker}/orderbook`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Kalshi orderbook error for ${ticker}: ${res.status}`);
  }

  const json = await res.json();
  // Kalshi returns { orderbook: { yes: [...], no: [...] } } with price/size in cents

  const yesBids: OrderBookLevel[] = (json.orderbook?.yes?.bids ?? []).map(([price, size]: [number, number]) => ({
    price: price / 100,
    size,
  }));

  const yesAsks: OrderBookLevel[] = (json.orderbook?.yes?.asks ?? []).map(([price, size]: [number, number]) => ({
    price: price / 100,
    size,
  }));

  const { bids, asks, mid, spread } = normalizeOrderBookLevels(yesBids, yesAsks);

  return {
    platform: 'kalshi',
    marketExternalId: ticker,
    bids,
    asks,
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

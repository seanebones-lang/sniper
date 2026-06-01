/**
 * Polymarket client (CLOB V2 + Gamma)
 * Phase 1: Public market discovery + order book / price data only.
 * Real trading auth comes in Phase 4.
 */

import { ClobClient } from '@polymarket/clob-client-v2';
import type { Market, OrderBook, OrderBookLevel } from '../types';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_HOST = 'https://clob.polymarket.com';

let clobClient: ClobClient | null = null;

function getClobClient(): ClobClient {
  if (!clobClient) {
    // Public reads only for Phase 1 — no signer/creds needed for order books
    clobClient = new ClobClient({
      host: CLOB_HOST,
      chain: 137, // Polygon
    });
  }
  return clobClient;
}

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomes?: string[];
  outcomePrices?: string[];
  volumeNum?: number;
  liquidityNum?: number;
  active: boolean;
  closed: boolean;
  archived: boolean;
  tokens?: Array<{
    token_id: string;
    outcome: string;
    price: number;
    winner: boolean;
  }>;
  // many more fields exist from Gamma — we only use what we need
}

export async function fetchPolymarketMarkets(limit = 50): Promise<Market[]> {
  const url = `${GAMMA_API}/markets?limit=${limit}&active=true&closed=false&archived=false`;
  const res = await fetch(url, { next: { revalidate: 30 } });

  if (!res.ok) {
    throw new Error(`Gamma API error: ${res.status}`);
  }

  const data: GammaMarket[] = await res.json();

  return data
    .filter((m) => m.active && !m.closed && !m.archived)
    .slice(0, limit)
    .map((m): Market => {
      // Best effort price extraction (first token or average)
      const price = m.tokens?.[0]?.price ?? (m.outcomePrices?.[0] ? parseFloat(m.outcomePrices[0]) : undefined);

      return {
        id: m.id,
        platform: 'polymarket',
        externalId: m.tokens?.[0]?.token_id ?? m.id, // prefer token_id for order books
        question: m.question,
        status: m.closed ? 'closed' : 'open',
        volume: m.volumeNum ?? 0,
        liquidity: m.liquidityNum ?? 0,
        lastPrice: price,
        updatedAt: new Date().toISOString(),
      };
    });
}

export async function fetchPolymarketOrderBook(tokenId: string): Promise<OrderBook> {
  const client = getClobClient();

  // The SDK method is getOrderBook or similar — adjust if the exact API differs
  const book = await client.getOrderBook(tokenId);

  const bids: OrderBookLevel[] = (book?.bids ?? []).map((b: any) => ({
    price: parseFloat(b.price),
    size: parseFloat(b.size),
  }));

  const asks: OrderBookLevel[] = (book?.asks ?? []).map((a: any) => ({
    price: parseFloat(a.price),
    size: parseFloat(a.size),
  }));

  const mid = bids.length && asks.length
    ? (bids[0].price + asks[0].price) / 2
    : undefined;

  const spread = bids.length && asks.length
    ? asks[0].price - bids[0].price
    : undefined;

  return {
    platform: 'polymarket',
    marketExternalId: tokenId,
    bids,
    asks,
    mid,
    spread,
    timestamp: new Date().toISOString(),
  };
}

// Lightweight price fetch (mid or last trade) for quick UI updates
export async function fetchPolymarketPrice(tokenId: string): Promise<number | null> {
  try {
    const book = await fetchPolymarketOrderBook(tokenId);
    return book.mid ?? (book.bids[0]?.price ?? book.asks[0]?.price ?? null);
  } catch {
    return null;
  }
}

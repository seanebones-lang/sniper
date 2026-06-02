/**
 * Polymarket client (CLOB V2 + Gamma)
 * Supports both public reads and (heavily gated) real trading.
 */

import { ClobClient, Side } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import type { Market, OrderBook, OrderBookLevel } from '../types';
import { getErrorMessage } from '../error-message';
import { normalizeOrderBookLevels } from '../orderbook';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_HOST = 'https://clob.polymarket.com';

let publicClient: ClobClient | null = null;
let tradingClient: ClobClient | null = null;

function getPublicClient(): ClobClient {
  if (!publicClient) {
    publicClient = new ClobClient({
      host: CLOB_HOST,
      chain: 137,
    });
  }
  return publicClient;
}

/**
 * Returns an authenticated ClobClient for real trading.
 * Only use this when SNIPER_ENABLE_REAL_EXECUTION=true and you have explicit user consent.
 */
export function getTradingClient(privateKey: string): ClobClient {
  if (tradingClient) return tradingClient;

  const account = privateKeyToAccount(privateKey as `0x${string}`);

  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  tradingClient = new ClobClient({
    host: CLOB_HOST,
    chain: 137,
    signer: walletClient as any, // viem wallet client works with the SDK
  });

  return tradingClient;
}

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomes?: string[] | string;
  outcomePrices?: string[] | string;
  clobTokenIds?: string[] | string;
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

/** Gamma often returns JSON-encoded arrays as strings (e.g. outcomePrices, clobTokenIds). */
function parseGammaArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch {
      return [];
    }
  }
  return [];
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
      const outcomePrices = parseGammaArray<string>(m.outcomePrices);
      const clobTokenIds = parseGammaArray<string>(m.clobTokenIds);
      const price =
        m.tokens?.[0]?.price ??
        (outcomePrices[0] != null ? parseFloat(outcomePrices[0]) : undefined);

      return {
        id: m.id,
        platform: 'polymarket',
        // CLOB order books require the token ID, not the market ID
        externalId: m.tokens?.[0]?.token_id ?? clobTokenIds[0] ?? m.id,
        question: m.question,
        status: m.closed ? 'closed' : 'open',
        volume: m.volumeNum ?? 0,
        liquidity: m.liquidityNum ?? 0,
        lastPrice: price != null && !Number.isNaN(price) ? price : undefined,
        updatedAt: new Date().toISOString(),
      };
    });
}

export async function fetchPolymarketMarketByTokenId(tokenId: string): Promise<Market | null> {
  const url = `${GAMMA_API}/markets?clob_token_ids=${encodeURIComponent(tokenId)}&limit=1`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  if (!res.ok) return null;

  const data: GammaMarket[] = await res.json();
  const m = data[0];
  if (!m) return null;

  const outcomePrices = parseGammaArray<string>(m.outcomePrices);
  const clobTokenIds = parseGammaArray<string>(m.clobTokenIds);
  const price =
    m.tokens?.[0]?.price ??
    (outcomePrices[0] != null ? parseFloat(outcomePrices[0]) : undefined);

  return {
    id: m.id,
    platform: 'polymarket',
    externalId: m.tokens?.[0]?.token_id ?? clobTokenIds[0] ?? tokenId,
    question: m.question,
    status: m.closed ? 'closed' : 'open',
    volume: m.volumeNum ?? 0,
    liquidity: m.liquidityNum ?? 0,
    lastPrice: price != null && !Number.isNaN(price) ? price : undefined,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchPolymarketOrderBook(tokenId: string): Promise<OrderBook> {
  const client = getPublicClient();

  const book = await client.getOrderBook(tokenId);

  const bids: OrderBookLevel[] = (book?.bids ?? []).map((b: any) => ({
    price: parseFloat(b.price),
    size: parseFloat(b.size),
  }));

  const asks: OrderBookLevel[] = (book?.asks ?? []).map((a: any) => ({
    price: parseFloat(a.price),
    size: parseFloat(a.size),
  }));

  const { bids: sortedBids, asks: sortedAsks, mid, spread } = normalizeOrderBookLevels(bids, asks);

  return {
    platform: 'polymarket',
    marketExternalId: tokenId,
    bids: sortedBids,
    asks: sortedAsks,
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

/**
 * Place a real limit order on Polymarket.
 * This should ONLY be called from the Real Executor after all risk checks pass.
 */
/**
 * Get open orders for the authenticated user.
 * Useful for reconciliation of real Polymarket trades.
 */
export async function getPolymarketOpenOrders(privateKey: string): Promise<any> {
  try {
    const client = getTradingClient(privateKey);
    // The CLOB SDK supports getOpenOrders
    const orders = await client.getOpenOrders();
    return orders;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Polymarket] getOpenOrders failed:', err);
    return [];
  }
}

/**
 * Cancel an order (best effort).
 */
export async function cancelPolymarketOrder(privateKey: string, orderId: string): Promise<boolean> {
  try {
    const client = getTradingClient(privateKey);
    await client.cancelOrder({ orderID: orderId });
    return true;
  } catch {
    return false;
  }
}

export async function placePolymarketLimitOrder(params: {
  privateKey: string;
  tokenId: string;
  price: number;           // 0-1 decimal (e.g. 0.47)
  size: number;            // in shares
  side: 'BUY' | 'SELL';
}): Promise<{ success: boolean; orderId?: string; error?: string }> {
  try {
    const client = getTradingClient(params.privateKey);

    // Ensure we have L2 credentials (this will create/derive if needed)
    await client.createOrDeriveApiKey();

    const order = await client.createAndPostOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side === 'BUY' ? Side.BUY : Side.SELL,
      },
      {
        tickSize: '0.01', // safe default, can be improved later
        negRisk: false,
      }
    );

    return {
      success: true,
      orderId: order?.orderID || 'submitted',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Polymarket] Real order failed:', err);
    return {
      success: false,
      error: message,
    };
  }
}

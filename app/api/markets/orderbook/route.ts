import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { fetchPolymarketOrderBook, fetchPolymarketMarketByTokenId } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';
import { getMarket } from '@/lib/markets';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') as 'polymarket' | 'kalshi' | null;
  const id = searchParams.get('id'); // externalId / tokenId / ticker

  if (!platform || !id) {
    return NextResponse.json({ error: 'Missing platform or id' }, { status: 400 });
  }

  try {
    let book;
    let market = await getMarket(platform, id);

    if (platform === 'polymarket') {
      book = await fetchPolymarketOrderBook(id);
      if (!market) {
        const lookedUp = await fetchPolymarketMarketByTokenId(id);
        if (lookedUp) market = lookedUp;
      }
    } else {
      book = await fetchKalshiOrderBook(id);
    }

    return NextResponse.json({
      ...book,
      market: market ? {
        question: market.question,
        lastPrice: market.lastPrice,
        volume: market.volume,
        liquidity: market.liquidity,
      } : null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch order book', details: message },
      { status: 500 }
    );
  }
}

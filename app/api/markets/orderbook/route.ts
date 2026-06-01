import { NextResponse } from 'next/server';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') as 'polymarket' | 'kalshi' | null;
  const id = searchParams.get('id'); // externalId / tokenId / ticker

  if (!platform || !id) {
    return NextResponse.json({ error: 'Missing platform or id' }, { status: 400 });
  }

  try {
    if (platform === 'polymarket') {
      const book = await fetchPolymarketOrderBook(id);
      return NextResponse.json(book);
    } else {
      const book = await fetchKalshiOrderBook(id);
      return NextResponse.json(book);
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: 'Failed to fetch order book', details: err?.message },
      { status: 500 }
    );
  }
}

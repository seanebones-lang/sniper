import { NextResponse } from 'next/server';
import { getAllMarkets } from '@/lib/markets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const markets = await getAllMarkets();
    return NextResponse.json({ markets, count: markets.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/markets] error', err);
    return NextResponse.json(
      { error: 'Failed to fetch markets', details: message },
      { status: 500 }
    );
  }
}

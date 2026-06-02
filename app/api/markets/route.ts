import { NextResponse } from 'next/server';
import { getAllMarkets } from '@/lib/markets';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const markets = await getAllMarkets();
    return NextResponse.json({ markets, count: markets.length });
  } catch (err: unknown) {
    console.error('[api/markets] error', err);
    return NextResponse.json(
      { error: 'Failed to fetch markets', details: err?.message },
      { status: 500 }
    );
  }
}

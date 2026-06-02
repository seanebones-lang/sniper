import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { getAllMarkets } from '@/lib/markets';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';
    const markets = await getAllMarkets(force);
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

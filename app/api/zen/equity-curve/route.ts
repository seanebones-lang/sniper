import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { getZenEquitySnapshot } from '@/lib/zen/equity';

export async function GET() {
  try {
    const snapshot = await getZenEquitySnapshot();
    return NextResponse.json(snapshot, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

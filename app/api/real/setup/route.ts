import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import {
  clearPolymarketSetupCache,
  ensurePolymarketTradingReady,
} from '@/lib/clients/polymarket-trading-setup';

/** Force Polymarket CLOB sync + gasless pUSD approvals via relayer. */
export async function POST() {
  try {
    clearPolymarketSetupCache();
    const result = await ensurePolymarketTradingReady({ force: true });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err) || 'Setup failed' },
      { status: 500 },
    );
  }
}

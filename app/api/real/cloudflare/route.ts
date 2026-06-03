import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';
import {
  clearPolymarketBrowserSession,
  getPolymarketBrowserSessionFromDb,
  setPolymarketBrowserSession,
} from '@/lib/settings/polymarket-browser-session';
import { reloadPolymarketHttp } from '@/lib/clients/polymarket-http-proxy';
import { placePolymarketLimitOrder, getPolymarketPrivateKey } from '@/lib/clients/polymarket-trading';
import { fetchPolymarketMarkets } from '@/lib/clients/polymarket';

export async function GET() {
  const session = await getPolymarketBrowserSessionFromDb();
  const fromEnv = !!(
    process.env.POLYMARKET_CF_CLEARANCE?.trim() && process.env.POLYMARKET_USER_AGENT?.trim()
  );
  return NextResponse.json({
    configured: fromEnv || !!session,
    fromEnv,
    hasCfClearance: !!(session?.cfClearance || process.env.POLYMARKET_CF_CLEARANCE),
  });
}

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  try {
    const body = (await req.json()) as {
      cfClearance?: string | null;
      userAgent?: string | null;
      testOrder?: boolean;
    };

    if (body.cfClearance === null || body.userAgent === null) {
      await clearPolymarketBrowserSession();
      return NextResponse.json({ saved: true, cleared: true });
    }

    if (!body.cfClearance?.trim() || !body.userAgent?.trim()) {
      return NextResponse.json({ error: 'cfClearance and userAgent required' }, { status: 400 });
    }

    await setPolymarketBrowserSession(body.cfClearance, body.userAgent);
    await reloadPolymarketHttp();

    let orderTest: { success: boolean; error?: string; orderId?: string } | undefined;
    if (body.testOrder) {
      const pk = getPolymarketPrivateKey();
      const markets = await fetchPolymarketMarkets(3);
      const tokenId = markets[0]?.externalId;
      if (pk && tokenId) {
        orderTest = await placePolymarketLimitOrder({
          privateKey: pk,
          tokenId,
          price: 0.01,
          size: 5,
          side: 'BUY',
          postOnly: true,
        });
      } else {
        orderTest = { success: false, error: 'No key or market for test' };
      }
    }

    return NextResponse.json({
      saved: true,
      message:
        'Browser session saved. CLOB POSTs now include cf_clearance — required for many datacenter proxies.',
      orderTest,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed' }, { status: 400 });
  }
}

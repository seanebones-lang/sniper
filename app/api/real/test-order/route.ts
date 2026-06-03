import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { isRealExecutionAllowed } from '@/lib/execution/real-executor';
import { reloadPolymarketHttp } from '@/lib/clients/polymarket-http-proxy';
import { checkPolymarketGeoblock } from '@/lib/clients/polymarket-geoblock';
import {
  getPolymarketPrivateKey,
  placePolymarketLimitOrder,
  placePolymarketMarketOrder,
} from '@/lib/clients/polymarket-trading';
import { fetchPolymarketMarkets } from '@/lib/clients/polymarket';
import { ensurePolymarketTradingReady } from '@/lib/clients/polymarket-trading-setup';

export async function POST() {
  if (!(await isRealExecutionAllowed())) {
    return NextResponse.json({ error: 'Real execution not allowed' }, { status: 403 });
  }

  try {
    await reloadPolymarketHttp();
    const geo = await checkPolymarketGeoblock({ force: true, ignoreSkip: true });
    const pk = getPolymarketPrivateKey();
    if (!pk) {
      return NextResponse.json({ error: 'POLYMARKET_PRIVATE_KEY not set' }, { status: 400 });
    }

    const setup = await ensurePolymarketTradingReady({ force: true });
    const markets = await fetchPolymarketMarkets(5);
    const tokenId = markets[0]?.externalId;
    if (!tokenId) {
      return NextResponse.json({ error: 'No market for test' }, { status: 400 });
    }

    const limit = await placePolymarketLimitOrder({
      privateKey: pk,
      tokenId,
      price: 0.01,
      size: 5,
      side: 'BUY',
      postOnly: true,
    });

    const market = await placePolymarketMarketOrder({
      privateKey: pk,
      tokenId,
      amountUsd: 1,
      side: 'BUY',
      orderType: 'FOK',
    });

    const tradingOk = limit.success || market.success;

    return NextResponse.json({
      tradingOk,
      geoblock: geo,
      setup,
      limit,
      market,
      hint: tradingOk
        ? 'CLOB accepted an order — runner should be able to trade.'
        : 'Still blocked. On /real: paste cf_clearance + User-Agent from browser (see docs), or use a residential IE proxy.',
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

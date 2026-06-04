import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';
import {
  clearPolymarketProxyUrl,
  getPolymarketProxyFromDb,
  maskProxyUrl,
  setPolymarketProxyUrl,
} from '@/lib/settings/polymarket-proxy';
import {
  getPolymarketProxyUrlFromEnv,
  reloadPolymarketHttp,
  resolvePolymarketProxyUrl,
} from '@/lib/clients/polymarket-http-proxy';
import { checkPolymarketGeoblock } from '@/lib/clients/polymarket-geoblock';

export async function GET() {
  const fromEnv = getPolymarketProxyUrlFromEnv();
  const fromDb = await getPolymarketProxyFromDb();
  const active = await resolvePolymarketProxyUrl();
  const { getPolymarketProxyPoolSize } = await import('@/lib/clients/polymarket-http-proxy');
  return NextResponse.json({
    configured: !!active,
    fromEnv: !!fromEnv,
    fromDb: !!fromDb,
    poolSize: getPolymarketProxyPoolSize(),
    source: fromDb && active === fromDb ? 'db' : fromEnv && active === fromEnv ? 'env' : active ? 'unknown' : null,
    maskedUrl: active ? maskProxyUrl(active) : null,
    railwayUrl: 'https://sniper-production-e817.up.railway.app',
  });
}

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  try {
    const body = (await req.json()) as { url?: string | null; testOnly?: boolean };
    if (body.url === null || body.url === '') {
      await clearPolymarketProxyUrl();
    } else if (typeof body.url === 'string') {
      await setPolymarketProxyUrl(body.url);
    } else {
      return NextResponse.json({ error: 'url required' }, { status: 400 });
    }

    await reloadPolymarketHttp();
    const geo = await checkPolymarketGeoblock({ force: true, ignoreSkip: true });
    return NextResponse.json({
      saved: true,
      geoblock: geo,
      tradingAllowed: !geo.blocked,
      message: geo.blocked
        ? 'Still blocked — try a different proxy country (Sweden, Spain, Ireland work; US/UK/Germany/Netherlands do not).'
        : 'Location check passed — the bot can place orders.',
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Failed' }, { status: 400 });
  }
}

import axios from 'axios';
import { ensurePolymarketProxyConfigured, getPolymarketFetchInit } from '../lib/clients/polymarket-http-proxy';
import { checkPolymarketGeoblock } from '../lib/clients/polymarket-geoblock';

async function main() {
  const proxy = await ensurePolymarketProxyConfigured();
  console.log('Proxy:', proxy ? proxy.replace(/:[^:@]+@/, ':***@') : '(none)');

  const geo = await checkPolymarketGeoblock({ force: true, ignoreSkip: true });
  console.log('Geoblock (fetch):', geo);

  const fetchInit = await getPolymarketFetchInit();
  const clobTime = await fetch('https://clob.polymarket.com/time', {
    cache: 'no-store',
    ...fetchInit,
  });
  console.log('CLOB /time (fetch):', clobTime.status);

  try {
    const ax = await axios.get('https://clob.polymarket.com/time', { timeout: 10000 });
    console.log('CLOB /time (axios):', ax.status, ax.data);
  } catch (e: unknown) {
    const err = e as { response?: { status?: number; data?: unknown }; message?: string };
    console.log('CLOB /time (axios) error:', err.response?.status, err.response?.data ?? err.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { getPolymarketPrivateKey, getTradingClient, ensurePolymarketApiCreds } from '../lib/clients/polymarket-trading';
import { ensurePolymarketProxyConfigured } from '../lib/clients/polymarket-http-proxy';

async function main() {
  await ensurePolymarketProxyConfigured();
  const pk = getPolymarketPrivateKey();
  if (!pk) throw new Error('no key');
  const client = getTradingClient(pk);
  try {
    await ensurePolymarketApiCreds(client);
    const creds = (client as { creds?: { key?: string } }).creds;
    console.log('API creds OK, key prefix:', creds?.key?.slice(0, 12));
  } catch (e) {
    console.error('ensurePolymarketApiCreds failed:', e);
  }
}

main();

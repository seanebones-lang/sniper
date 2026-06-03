/**
 * Quick Kalshi WS probe: connect, subscribe to one open market, print first messages.
 * Usage: npx tsx scripts/probe-kalshi-ws.ts [TICKER]
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnvLocal() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

async function main() {
  const ticker = process.argv[2];
  const { getKalshiCredentialsOptional } = await import('../lib/clients/kalshi-auth');
  const { KalshiWSClient } = await import('../lib/ws/kalshi');
  const { KalshiWSOrderbookState } = await import('../lib/ws/kalshi-orderbook-state');

  const creds = getKalshiCredentialsOptional();
  if (!creds) {
    console.error('Missing KALSHI_ACCESS_KEY / KALSHI_RSA_PRIVATE_KEY');
    process.exit(1);
  }

  let target = ticker;
  if (!target) {
    const res = await fetch(
      'https://external-api.kalshi.com/trade-api/v2/markets?status=open&limit=1',
    );
    const json = (await res.json()) as { markets?: Array<{ ticker: string }> };
    target = json.markets?.[0]?.ticker;
  }
  if (!target) {
    console.error('No open market ticker found');
    process.exit(1);
  }

  console.log('Probing Kalshi WS for', target);
  const state = new KalshiWSOrderbookState();
  let gotBook = false;

  const client = new KalshiWSClient({
    credentials: creds,
    channels: ['orderbook_delta'],
    onOpen: () => console.log('onOpen'),
    onClose: () => console.log('onClose'),
    onMessage: (msg) => {
      const type = String(msg.type ?? 'raw');
      if (type === 'error') {
        console.log('error', msg.msg);
        return;
      }
      const book = state.process(msg);
      if (book && !gotBook) {
        gotBook = true;
        console.log('book', {
          ticker: book.marketExternalId,
          bid: book.bids[0]?.price,
          ask: book.asks[0]?.price,
          mid: book.mid,
        });
        client.disconnect();
        process.exit(0);
      }
      if (type === 'subscribed') console.log('subscribed', msg);
    },
    onError: (e) => console.error('onError', e),
  });

  client.connect([target]);
  setTimeout(() => {
    console.error('Timeout — no orderbook message in 15s');
    client.disconnect();
    process.exit(2);
  }, 15_000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';
import { fetchPolymarketMarketByTokenId, fetchPolymarketOrderBook } from '../lib/clients/polymarket';

const STRATEGY_ID = '8cb568b7-1901-4fc5-8c35-db4cfc7557b0';

async function main() {
  const pos = await getRealOpenPositionsByStrategy([STRATEGY_ID]);
  for (const p of pos.get(STRATEGY_ID) ?? []) {
    const m = await fetchPolymarketMarketByTokenId(p.marketExternalId);
    const book = await fetchPolymarketOrderBook(p.marketExternalId);
    console.log('---', m?.question?.slice(0, 60));
    console.log('token', p.marketExternalId);
    console.log('bids', JSON.stringify(book.bids?.slice(0, 5)));
    console.log('asks', JSON.stringify(book.asks?.slice(0, 5)));
    console.log('mid', book.mid, 'net', p.netSize, 'entry', p.avgEntryPrice);
  }
}

main().catch(console.error);

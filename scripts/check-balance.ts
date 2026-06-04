/** Quick prod balance + position check. */
import { getPolymarketPrivateKey, getPolymarketUsdcBalance } from '../lib/clients/polymarket-trading';
import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';
import { db } from '../lib/db';

async function main() {
  const pk = getPolymarketPrivateKey();
  const bal = pk ? await getPolymarketUsdcBalance(pk, { syncFirst: true }) : null;
  const live = await db.query.strategies.findMany({
    where: (s, { and, eq }) => and(eq(s.isActive, true), eq(s.paperOnly, false)),
  });
  const pos = await getRealOpenPositionsByStrategy(live.map((s) => s.id));
  let n = 0;
  for (const [, arr] of pos) {
    n += arr.length;
    for (const p of arr) {
      console.log('pos', p.marketExternalId.slice(0, 16), 'net', p.netSize, '@', p.avgEntryPrice);
    }
  }
  console.log('USDC', bal);
  console.log('openPositions', n);
}

main().catch(console.error);

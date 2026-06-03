/**
 * One-shot: post a tiny GTC buy and print the raw CLOB response (for orderID parsing).
 * Usage: npx tsx scripts/probe-polymarket-order.ts [tokenId]
 */
import { db, auditEvents } from '../lib/db';
import { desc } from 'drizzle-orm';
import { getPolymarketPrivateKey, placePolymarketLimitOrder } from '../lib/clients/polymarket-trading';
import { fetchPolymarketMarkets } from '../lib/clients/polymarket';

async function main() {
  const tokenArg = process.argv[2];
  let tokenId = tokenArg;
  if (!tokenId) {
    const markets = await fetchPolymarketMarkets(5);
    const m = markets.find((x) => x.platform === 'polymarket' && x.externalId);
    tokenId = m?.externalId;
  }
  if (!tokenId) {
    console.error('No tokenId — pass as argv or ensure markets fetch works');
    process.exit(1);
  }

  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('POLYMARKET_PRIVATE_KEY missing');
    process.exit(1);
  }

  console.log('Token:', tokenId);
  const result = await placePolymarketLimitOrder({
    privateKey: pk,
    tokenId,
    price: 0.01,
    size: 5,
    side: 'BUY',
    postOnly: true,
  });
  console.log('Parsed:', JSON.stringify(result, null, 2));

  const audits = await db.query.auditEvents.findMany({
    where: (a, { eq }) => eq(a.action, 'real_order_result'),
    orderBy: [desc(auditEvents.createdAt)],
    limit: 1,
  });
  if (audits[0]) console.log('Last audit payload:', JSON.stringify(audits[0].payload, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

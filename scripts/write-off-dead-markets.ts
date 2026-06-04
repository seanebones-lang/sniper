/**
 * Write off ledger for delisted/dead CLOB markets; post Game 4 limit SELL.
 * APPLY=1 railway run --service sniper -- npx tsx scripts/write-off-dead-markets.ts
 */
import { db, positions, realTrades } from '../lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';
import {
  getPolymarketPrivateKey,
  placePolymarketLimitOrder,
  cancelPolymarketMarketOrders,
  getPolymarketTokenBalance,
} from '../lib/clients/polymarket-trading';
import { ensureMarket } from '../lib/markets';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';
const STRATEGY_ID = '8cb568b7-1901-4fc5-8c35-db4cfc7557b0';
const GAME4_TOKEN = '47147095594506692238697896514087867152422362229643774019197234088324196335335';

/** Tokens where CLOB returns "orderbook does not exist". */
const DEAD_TOKENS = new Set([
  '66001827658606844994148463229238966813912518248224954388385421446299173647931',
  '29654367635997330423989480284203408826351645806994843236766252973777536670042',
  '89440958677242635922243599682220367772270030849875850155268863561815210329601',
  '112793399830376345322195515723949689838787043880683449958745426972655010908000',
]);

async function writeOffToken(tokenId: string, netSize: number) {
  const marketId = await ensureMarket({ platform: 'polymarket', externalId: tokenId });
  await db
    .update(positions)
    .set({ sizeShares: '0', avgPrice: '0', updatedAt: new Date() })
    .where(and(eq(positions.platform, 'polymarket'), eq(positions.marketId, marketId)));

  const stuck = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.platform, 'polymarket'),
      eq(realTrades.marketExternalId, tokenId),
      inArray(realTrades.status, ['pending', 'needs_review']),
    ),
  });
  for (const t of stuck) {
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, t.id));
  }
  console.log(`  wrote off ledger (was ${netSize} shares); cancelled ${stuck.length} trade row(s)`);
  console.log('  NOTE: on-chain tokens may remain — redeem manually on Polymarket if market resolved.');
}

async function main() {
  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('No POLYMARKET_PRIVATE_KEY');
    process.exit(1);
  }

  const pos = await getRealOpenPositionsByStrategy([STRATEGY_ID]);
  const positionsList = pos.get(STRATEGY_ID) ?? [];
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN ===');

  for (const p of positionsList) {
    if (!DEAD_TOKENS.has(p.marketExternalId)) continue;
    console.log(`\nDEAD ${p.marketExternalId.slice(0, 16)}…`);
    if (APPLY) await writeOffToken(p.marketExternalId, p.netSize);
  }

  const game4 = positionsList.find((p) => p.marketExternalId === GAME4_TOKEN);
  if (game4) {
    console.log('\nGame 4 — cancel market orders + limit SELL @ 0.001');
    const onChain = await getPolymarketTokenBalance(pk, GAME4_TOKEN);
    const size = Math.floor(onChain ?? game4.netSize);
    console.log(`  on-chain=${onChain} sellSize=${size}`);
    if (APPLY && size > 0) {
      await cancelPolymarketMarketOrders(pk, GAME4_TOKEN);
      const r = await placePolymarketLimitOrder({
        privateKey: pk,
        tokenId: GAME4_TOKEN,
        price: 0.001,
        size,
        side: 'SELL',
      });
      if (r.success) {
        console.log(`  SELL posted ${r.orderId}`);
      } else if (r.error?.includes('active orders')) {
        console.log('  shares locked in existing CLOB order — writing off ledger (sell may already be on book @ 0.1¢)');
        await writeOffToken(GAME4_TOKEN, game4.netSize);
      } else {
        console.log(`  SELL failed: ${r.error}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

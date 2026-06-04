/**
 * Cancel stuck pending/needs_review real trades and zero dead-market ledger rows.
 * APPLY=1 railway run --service sniper -- npx tsx scripts/clear-ghost-pending.ts
 */
import { db, positions, realTrades } from '../lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { DEAD_MARKET_TOKENS } from '../lib/execution/dead-market-tokens';
import { ensureMarket } from '../lib/markets';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';

async function clearToken(tokenId: string) {
  const stuck = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.platform, 'polymarket'),
      eq(realTrades.marketExternalId, tokenId),
      inArray(realTrades.status, ['pending', 'needs_review']),
    ),
  });

  const marketId = await ensureMarket({ platform: 'polymarket', externalId: tokenId });
  console.log(`token ${tokenId.slice(0, 16)}… pending=${stuck.length}`);

  if (!APPLY) return;

  for (const t of stuck) {
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, t.id));
  }
  await db
    .update(positions)
    .set({ sizeShares: '0', avgPrice: '0', updatedAt: new Date() })
    .where(and(eq(positions.platform, 'polymarket'), eq(positions.marketId, marketId)));
  console.log(`  cancelled ${stuck.length} trade(s), zeroed ledger`);
}

async function main() {
  console.log(APPLY ? '=== APPLY ===' : '=== DRY RUN (set APPLY=1) ===');
  for (const tokenId of DEAD_MARKET_TOKENS) {
    await clearToken(tokenId);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

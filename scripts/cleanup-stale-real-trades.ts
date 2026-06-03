/**
 * Cancel pending real_trades that never received a CLOB order id.
 * Usage: set -a && . ./.env.local && set +a && npx tsx scripts/cleanup-stale-real-trades.ts
 */
import { db, realTrades } from '../lib/db';
import { eq, or, isNull, and, lt } from 'drizzle-orm';

async function main() {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const stale = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.status, 'pending'),
      lt(realTrades.createdAt, cutoff),
      or(eq(realTrades.txHash, 'submitted'), isNull(realTrades.txHash)),
    ),
    columns: { id: true, txHash: true, createdAt: true },
  });

  if (stale.length === 0) {
    console.log('No stale pending trades to cancel.');
    return;
  }

  for (const t of stale) {
    await db
      .update(realTrades)
      .set({ status: 'cancelled' })
      .where(eq(realTrades.id, t.id));
  }
  console.log(`Cancelled ${stale.length} stale pending real trade(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

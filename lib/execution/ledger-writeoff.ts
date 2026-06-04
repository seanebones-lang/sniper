import { db, auditEvents, realTrades } from '@/lib/db';
import { and, eq, inArray } from 'drizzle-orm';

async function logWriteOff(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({ actor: 'ledger-writeoff', action, payload });
  } catch {
    // best effort
  }
}

/** Cancel stuck pending/needs_review rows on a token so exits can retry cleanly. */
export async function cancelPendingRealTradesOnToken(tokenId: string): Promise<number> {
  const stuck = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.platform, 'polymarket'),
      eq(realTrades.marketExternalId, tokenId),
      inArray(realTrades.status, ['pending', 'needs_review']),
    ),
    limit: 50,
  });
  for (const t of stuck) {
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, t.id));
  }
  return stuck.length;
}

/**
 * Insert a synthetic filled SELL so trade aggregation matches on-chain reality.
 * Used for ghost/dust/dead-book ledger cleanup (on-chain may still hold worthless shares).
 */
export async function writeOffGhostLedgerPosition(
  tokenId: string,
  netSize: number,
  avgPrice: number,
  note: string,
): Promise<{ cancelledPending: number }> {
  const cancelledPending = await cancelPendingRealTradesOnToken(tokenId);
  await db.insert(realTrades).values({
    platform: 'polymarket',
    marketExternalId: tokenId,
    side: 'SELL',
    size: String(netSize),
    price: String(avgPrice),
    status: 'filled',
    filledAt: new Date(),
    txHash: 'ledger-sync',
  });
  await logWriteOff('ghost_ledger_writeoff', {
    tokenId: tokenId.slice(0, 24),
    netSize,
    avgPrice,
    note,
    cancelledPending,
  });
  return { cancelledPending };
}

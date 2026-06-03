/**
 * Compare DB ledger positions vs on-chain Polymarket conditional token balances.
 */
import { getRealOpenPositionsByStrategy } from '@/lib/execution/real-positions';
import { getPolymarketPrivateKey, getPolymarketTokenBalance } from '@/lib/clients/polymarket-trading';
import { db, realTrades } from '@/lib/db';
import { eq, inArray } from 'drizzle-orm';

export interface LedgerChainRow {
  platform: string;
  marketExternalId: string;
  ledgerNet: number;
  onChain: number | null;
  delta: number | null;
  strategyId: string;
  question?: string;
}

export interface LedgerChainAuditResult {
  rows: LedgerChainRow[];
  ghosts: LedgerChainRow[];
  mismatches: LedgerChainRow[];
}

export async function auditLedgerVsChain(strategyIds: string[]): Promise<LedgerChainAuditResult> {
  const byStrategy = await getRealOpenPositionsByStrategy(strategyIds);
  const rows: LedgerChainRow[] = [];
  const pk = getPolymarketPrivateKey();

  for (const strategyId of strategyIds) {
    for (const pos of byStrategy.get(strategyId) ?? []) {
      let onChain: number | null = null;
      if (pk && pos.platform === 'polymarket') {
        onChain = await getPolymarketTokenBalance(pk, pos.marketExternalId);
      }
      const delta = onChain != null ? pos.netSize - onChain : null;
      rows.push({
        platform: pos.platform,
        marketExternalId: pos.marketExternalId,
        ledgerNet: pos.netSize,
        onChain,
        delta,
        strategyId,
      });
    }
  }

  const ghosts = rows.filter(
    (r) => r.onChain != null && r.onChain <= 0.01 && r.ledgerNet > 0.01,
  );
  const mismatches = rows.filter(
    (r) => r.delta != null && Math.abs(r.delta) > 1 && r.onChain != null && r.onChain > 0.01,
  );

  return { rows, ghosts, mismatches };
}

/** Cancel phantom pending/needs_review BUY rows when chain balance is zero. */
export async function reconcileGhostPendingBuys(
  strategyIds: string[],
  dryRun = true,
): Promise<{ cancelled: number; ids: string[] }> {
  const audit = await auditLedgerVsChain(strategyIds);
  const ghostMarkets = new Set(audit.ghosts.map((g) => `${g.platform}:${g.marketExternalId}`));
  if (ghostMarkets.size === 0) return { cancelled: 0, ids: [] };

  const pending = await db.query.realTrades.findMany({
    where: (t, { and, eq, inArray: inArr }) =>
      and(
        inArr(t.status, ['pending', 'needs_review']),
        eq(t.side, 'BUY'),
      ),
    limit: 200,
  });

  const ids: string[] = [];
  for (const t of pending) {
    const key = `${t.platform}:${t.marketExternalId}`;
    if (!ghostMarkets.has(key)) continue;
    ids.push(t.id);
    if (!dryRun) {
      await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, t.id));
    }
  }

  return { cancelled: ids.length, ids };
}

/**
 * Compare ledger open positions to on-chain token balances; optionally cancel ghost BUY rows.
 * Run: railway run -- npx tsx scripts/reconcile-ledger-vs-chain.ts
 * Apply: APPLY=1 railway run -- npx tsx scripts/reconcile-ledger-vs-chain.ts
 */
import { db, strategies } from '../lib/db';
import { eq } from 'drizzle-orm';
import {
  auditLedgerVsChain,
  reconcileGhostPendingBuys,
} from '../lib/live/ledger-chain-audit';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';

async function main() {
  const live = await db.query.strategies.findMany({
    where: (s, { and, eq: eqFn }) => and(eqFn(s.isActive, true), eqFn(s.paperOnly, false)),
  });
  const ids = live.map((s) => s.id);
  if (ids.length === 0) {
    console.log('No active live strategies.');
    return;
  }

  const audit = await auditLedgerVsChain(ids);
  console.log(`\nLedger vs chain (${audit.rows.length} open markets):`);
  for (const r of audit.rows) {
    console.log(
      `  ${r.marketExternalId.slice(0, 14)}… ledger=${r.ledgerNet.toFixed(2)} chain=${r.onChain?.toFixed(2) ?? '—'} delta=${r.delta?.toFixed(2) ?? '—'}`,
    );
  }

  if (audit.ghosts.length > 0) {
    console.log(`\nGhost positions (ledger>0, chain≈0): ${audit.ghosts.length}`);
    for (const g of audit.ghosts) {
      console.log(`  ${g.marketExternalId.slice(0, 14)}… ledger=${g.ledgerNet}`);
    }
  }

  if (audit.mismatches.length > 0) {
    console.log(`\nSize mismatches: ${audit.mismatches.length}`);
    for (const m of audit.mismatches) {
      console.log(`  ${m.marketExternalId.slice(0, 14)}… delta=${m.delta?.toFixed(2)}`);
    }
  }

  const ghostFix = await reconcileGhostPendingBuys(ids, !APPLY);
  console.log(
    `\nGhost pending BUY rows ${APPLY ? 'cancelled' : 'would cancel'}: ${ghostFix.cancelled}`,
  );
  if (ghostFix.ids.length > 0) {
    for (const id of ghostFix.ids.slice(0, 10)) {
      console.log(`  ${id}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

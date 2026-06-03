/**
 * One-off diagnostic: paper_trades vs signals counts and run-session filter.
 * Usage: npx tsx scripts/diagnose-paper-fills.ts
 */
import { db, paperTrades, signals } from '@/lib/db';
import { count, gte } from 'drizzle-orm';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';

async function main() {
  const [ptTotal] = await db.select({ c: count() }).from(paperTrades);
  const [sigTotal] = await db.select({ c: count() }).from(signals);
  const runStart = await getPaperRunStartedAt();

  let ptSinceRun = ptTotal?.c ?? 0;
  if (runStart) {
    const [row] = await db
      .select({ c: count() })
      .from(paperTrades)
      .where(gte(paperTrades.filledAt, runStart));
    ptSinceRun = row?.c ?? 0;
  }

  const recentSig = await db.query.signals.findMany({
    limit: 5,
    orderBy: (s, { desc }) => [desc(s.createdAt)],
    columns: { id: true, createdAt: true, action: true },
  });
  const recentPt = await db.query.paperTrades.findMany({
    limit: 5,
    orderBy: (t, { desc }) => [desc(t.filledAt)],
    columns: { id: true, filledAt: true, signalId: true, side: true },
  });

  console.log(
    JSON.stringify(
      {
        paperTradesTotal: ptTotal?.c,
        paperTradesSinceRun: ptSinceRun,
        signalsTotal: sigTotal?.c,
        runStart: runStart?.toISOString() ?? null,
        recentSignals: recentSig,
        recentPaperTrades: recentPt,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

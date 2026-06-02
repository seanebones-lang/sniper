import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { getPaperBudgetSettings } from '@/lib/settings/paper-budget';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { db, paperTrades } from '@/lib/db';
import { gte, count } from 'drizzle-orm';
import { aggregatePaperPositions } from '@/lib/paper/positions';
import { computePaperLedger } from '@/lib/paper/ledger';
import { computeMarkToMarket } from '@/lib/paper/mark-to-market';
import type { PaperPnlSnapshot } from '@/lib/paper/portfolio';

/** Lightweight P&L endpoint — ledger + cached MTM without full portfolio build. */
export async function GET() {
  try {
    const [budget, runStart] = await Promise.all([
      getPaperBudgetSettings(),
      getPaperRunStartedAt(),
    ]);

    const runFilter = runStart ? gte(paperTrades.filledAt, runStart) : undefined;
    const [trades, totalCountRow] = await Promise.all([
      db.query.paperTrades.findMany({
        where: runFilter,
        orderBy: (t, { asc }) => [asc(t.filledAt)],
      }),
      db.select({ count: count() }).from(paperTrades).where(runFilter),
    ]);

    const positions = aggregatePaperPositions(trades);
    const ledger = computePaperLedger(
      budget.paperBudgetUsd,
      trades.map((t) => ({
        platform: t.platform,
        marketExternalId: t.marketExternalId,
        side: t.side,
        size: t.size,
        price: t.price,
        fee: t.fee,
      })),
    );
    const mtm = await computeMarkToMarket(positions);
    const totalEquityUsd = ledger.cashUsd + mtm.openMarkValueUsd;
    const netPnlUsd = totalEquityUsd - budget.paperBudgetUsd;

    const pnl: PaperPnlSnapshot = {
      computedAt: new Date().toISOString(),
      source: 'paper_trades_db',
      fillsInRun: ledger.fillCount,
      buyFills: ledger.buyCount,
      sellFills: ledger.sellCount,
      startingBudgetUsd: budget.paperBudgetUsd,
      cashUsd: ledger.cashUsd,
      openCostBasisUsd: mtm.openCostBasisUsd,
      openMarkValueUsd: mtm.openMarkValueUsd,
      realizedPnLUsd: ledger.realizedPnLUsd,
      unrealizedPnLUsd: mtm.unrealizedPnLUsd,
      totalEquityUsd,
      netPnlUsd,
      netPnlPct: budget.paperBudgetUsd > 0 ? (netPnlUsd / budget.paperBudgetUsd) * 100 : 0,
      totalFeesUsd: ledger.totalFeesUsd,
      openPositions: mtm.openPositionCount,
      positionsMarked: mtm.positionsMarked,
      marksUpdatedAt: mtm.markedAt,
    };

    return NextResponse.json({
      pnl,
      runSession: {
        startedAt: runStart?.toISOString() ?? null,
        fillsInRun: totalCountRow[0]?.count ?? trades.length,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

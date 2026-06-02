import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { getPaperBudgetSettings } from '@/lib/settings/paper-budget';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { db, paperTrades } from '@/lib/db';
import { gte } from 'drizzle-orm';
import { buildEquityCurve } from '@/lib/paper/equity-curve';
import { computePaperLedger } from '@/lib/paper/ledger';
import { aggregatePaperPositions } from '@/lib/paper/positions';
import { computeMarkToMarket } from '@/lib/paper/mark-to-market';

export async function GET() {
  try {
    const [budget, runStart] = await Promise.all([
      getPaperBudgetSettings(),
      getPaperRunStartedAt(),
    ]);

    const runFilter = runStart ? gte(paperTrades.filledAt, runStart) : undefined;
    const trades = await db.query.paperTrades.findMany({
      where: runFilter,
      orderBy: (t, { asc }) => [asc(t.filledAt)],
    });

    const curve = buildEquityCurve(
      budget.paperBudgetUsd,
      trades.map((t) => ({
        platform: t.platform,
        marketExternalId: t.marketExternalId,
        side: t.side,
        size: t.size,
        price: t.price,
        fee: t.fee,
        filledAt: t.filledAt,
      })),
    );

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
    const liveEquity = ledger.cashUsd + mtm.openMarkValueUsd;

    curve.push({
      t: Date.now(),
      equity: liveEquity,
      pnl: liveEquity - budget.paperBudgetUsd,
      cash: ledger.cashUsd,
      exposure: mtm.openMarkValueUsd,
    });

    return NextResponse.json({
      startingBudgetUsd: budget.paperBudgetUsd,
      liveEquityUsd: liveEquity,
      netPnlUsd: liveEquity - budget.paperBudgetUsd,
      realizedPnLUsd: ledger.realizedPnLUsd,
      unrealizedPnLUsd: mtm.unrealizedPnLUsd,
      fillCount: trades.length,
      points: curve.map((p) => ({
        t: p.t,
        equity: p.equity,
        pnl: p.pnl,
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
}

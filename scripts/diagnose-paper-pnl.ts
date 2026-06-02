import { db, paperTrades } from '../lib/db';
import { getPaperBudgetSettings } from '../lib/settings/paper-budget';
import { getPaperRunStartedAt } from '../lib/paper/run-session';
import { gte } from 'drizzle-orm';
import { computePaperLedger } from '../lib/paper/ledger';
import { aggregatePaperPositions } from '../lib/paper/positions';
import { computeMarkToMarket } from '../lib/paper/mark-to-market';

async function main() {
  const budget = await getPaperBudgetSettings();
  const runStart = await getPaperRunStartedAt();
  const trades = await db.query.paperTrades.findMany({
    where: runStart ? gte(paperTrades.filledAt, runStart) : undefined,
    orderBy: (t, { asc }) => [asc(t.filledAt)],
  });

  const ledgerTrades = trades.map((t) => ({
    platform: t.platform,
    marketExternalId: t.marketExternalId,
    side: t.side,
    size: t.size,
    price: t.price,
    fee: t.fee,
  }));

  const ledger = computePaperLedger(budget.paperBudgetUsd, ledgerTrades);
  const positions = aggregatePaperPositions(trades);
  const mtm = await computeMarkToMarket(positions);

  const brokenAvailable = budget.paperBudgetUsd - ledger.openExposureCostUsd;
  const costEquity = ledger.cashUsd + ledger.openExposureCostUsd;
  const mtmEquity = ledger.cashUsd + mtm.openMarkValueUsd;

  console.log(JSON.stringify({
    runStart: runStart?.toISOString() ?? null,
    trades: trades.length,
    buys: ledger.buyCount,
    sells: ledger.sellCount,
    feesUsd: Number(ledger.totalFeesUsd.toFixed(4)),
    startingBudget: budget.paperBudgetUsd,
    legacyBrokenAvailable: Number(brokenAvailable.toFixed(2)),
    apiAvailableUsd: Number(ledger.cashUsd.toFixed(2)),
    openCostBasisUsd: Number(ledger.openExposureCostUsd.toFixed(2)),
    openMarkValueUsd: Number(mtm.openMarkValueUsd.toFixed(2)),
    openPositions: mtm.openPositionCount,
    costBasisEquityUsd: Number(costEquity.toFixed(2)),
    mtmEquityUsd: Number(mtmEquity.toFixed(2)),
    realizedPnLUsd: Number(ledger.realizedPnLUsd.toFixed(2)),
    netPnlUsd: Number((mtmEquity - budget.paperBudgetUsd).toFixed(2)),
    regression: Math.abs(brokenAvailable - ledger.cashUsd) < 0.02 && ledger.sellCount > 0
      ? 'BUG: available still uses startingBudget - exposure after sells'
      : 'ok',
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

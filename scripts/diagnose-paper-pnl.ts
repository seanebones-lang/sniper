import { db, paperTrades } from '../lib/db';
import { getPaperBudgetSettings } from '../lib/settings/paper-budget';
import { getPaperRunStartedAt } from '../lib/paper/run-session';
import { gte } from 'drizzle-orm';

async function main() {
  const budget = await getPaperBudgetSettings();
  const runStart = await getPaperRunStartedAt();
  const trades = await db.query.paperTrades.findMany({
    where: runStart ? gte(paperTrades.filledAt, runStart) : undefined,
    orderBy: (t, { asc }) => [asc(t.filledAt)],
  });

  let cash = budget.paperBudgetUsd;
  let buys = 0;
  let sells = 0;
  let fees = 0;

  for (const t of trades) {
    const size = parseFloat(t.size);
    const price = parseFloat(t.price);
    const fee = parseFloat(t.fee ?? '0');
    fees += fee;
    if (t.side === 'BUY') {
      cash -= size * price + fee;
      buys++;
    } else {
      cash += size * price - fee;
      sells++;
    }
  }

  const posMap = new Map<string, { net: number; cost: number }>();
  for (const t of trades) {
    const key = `${t.platform}:${t.marketExternalId}`;
    const size = parseFloat(t.size);
    const price = parseFloat(t.price);
    const row = posMap.get(key) ?? { net: 0, cost: 0 };
    if (t.side === 'BUY') {
      row.net += size;
      row.cost += size * price;
    } else {
      row.net -= size;
      row.cost -= size * price;
    }
    posMap.set(key, row);
  }

  let exposure = 0;
  let openCount = 0;
  for (const [, r] of posMap) {
    if (Math.abs(r.net) > 0.01) {
      exposure += Math.abs(r.cost);
      openCount++;
    }
  }

  const brokenAvailable = budget.paperBudgetUsd - exposure;
  const trueEquity = cash + exposure;
  const pnl = trueEquity - budget.paperBudgetUsd;

  console.log(JSON.stringify({
    runStart: runStart?.toISOString() ?? null,
    trades: trades.length,
    buys,
    sells,
    feesUsd: Number(fees.toFixed(4)),
    startingBudget: budget.paperBudgetUsd,
    uiShowsAvailable: Number(brokenAvailable.toFixed(2)),
    trueCashUsd: Number(cash.toFixed(2)),
    openExposureCostUsd: Number(exposure.toFixed(2)),
    openPositions: openCount,
    trueTotalEquityUsd: Number(trueEquity.toFixed(2)),
    netPnlUsd: Number(pnl.toFixed(2)),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import type { LedgerTrade } from './ledger';

export interface EquityCurvePoint {
  t: number;
  equity: number;
  pnl: number;
  cash: number;
  exposure: number;
}

/** Stepwise equity curve from chronological paper fills (cost-basis exposure). */
export function buildEquityCurve(
  startingBudgetUsd: number,
  trades: Array<LedgerTrade & { filledAt: Date }>,
): EquityCurvePoint[] {
  if (trades.length === 0) {
    const now = Date.now();
    return [{ t: now, equity: startingBudgetUsd, pnl: 0, cash: startingBudgetUsd, exposure: 0 }];
  }

  const points: EquityCurvePoint[] = [];
  let cash = startingBudgetUsd;
  const posMap = new Map<string, { net: number; cost: number }>();

  const firstT = trades[0].filledAt.getTime();
  points.push({
    t: firstT - 60_000,
    equity: startingBudgetUsd,
    pnl: 0,
    cash: startingBudgetUsd,
    exposure: 0,
  });

  for (const trade of trades) {
    const size = parseFloat(trade.size);
    const price = parseFloat(trade.price);
    const fee = parseFloat(trade.fee ?? '0');
    const key = `${trade.platform}:${trade.marketExternalId}`;
    const row = posMap.get(key) ?? { net: 0, cost: 0 };

    if (trade.side === 'BUY') {
      cash -= size * price + fee;
      row.net += size;
      row.cost += size * price;
    } else {
      const avg = row.net > 0.01 ? row.cost / row.net : price;
      cash += size * price - fee;
      row.net -= size;
      row.cost -= avg * size;
      if (row.net <= 0.01) {
        row.net = 0;
        row.cost = 0;
      }
    }
    posMap.set(key, row);

    let exposure = 0;
    for (const [, r] of posMap) {
      if (Math.abs(r.net) > 0.01) exposure += Math.abs(r.cost);
    }

    const equity = cash + exposure;
    points.push({
      t: trade.filledAt.getTime(),
      equity,
      pnl: equity - startingBudgetUsd,
      cash,
      exposure,
    });
  }

  return points;
}

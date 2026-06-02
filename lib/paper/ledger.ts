export interface PaperLedgerSummary {
  startingBudgetUsd: number;
  /** Cash not deployed in open positions (includes realized PnL from closed trades) */
  cashUsd: number;
  /** Cost basis of still-open positions */
  openExposureCostUsd: number;
  /** cash + open exposure at cost (fallback when live marks unavailable) */
  totalEquityUsd: number;
  netPnlUsd: number;
  /** Locked-in P&L from closed portions of positions */
  realizedPnLUsd: number;
  totalFeesUsd: number;
  buyCount: number;
  sellCount: number;
  fillCount: number;
}

export type LedgerTrade = {
  platform: string;
  marketExternalId: string;
  side: string;
  size: string;
  price: string;
  fee?: string | null;
};

/**
 * Walk paper fills chronologically and derive cash + equity.
 * The old UI used `startingBudget - openExposure`, which ignores sell proceeds
 * and always sums to the starting bankroll when flat.
 */
export function computePaperLedger(
  startingBudgetUsd: number,
  trades: LedgerTrade[],
): PaperLedgerSummary {
  let cashUsd = startingBudgetUsd;
  let totalFeesUsd = 0;
  let realizedPnLUsd = 0;
  let buyCount = 0;
  let sellCount = 0;

  const posMap = new Map<string, { net: number; cost: number }>();

  for (const t of trades) {
    const size = parseFloat(t.size);
    const price = parseFloat(t.price);
    const fee = parseFloat(t.fee ?? '0');
    totalFeesUsd += fee;

    if (t.side === 'BUY') {
      cashUsd -= size * price + fee;
      buyCount++;
    } else {
      cashUsd += size * price - fee;
      sellCount++;
    }

    const key = `${t.platform}:${t.marketExternalId}`;
    const row = posMap.get(key) ?? { net: 0, cost: 0 };
    if (t.side === 'BUY') {
      row.net += size;
      row.cost += size * price;
    } else {
      const avg = row.net > 0.01 ? row.cost / row.net : price;
      realizedPnLUsd += (price - avg) * size;
      row.net -= size;
      row.cost -= avg * size;
      if (row.net <= 0.01) {
        row.net = 0;
        row.cost = 0;
      }
    }
    posMap.set(key, row);
  }

  let openExposureCostUsd = 0;
  for (const [, row] of posMap) {
    if (Math.abs(row.net) > 0.01) {
      openExposureCostUsd += Math.abs(row.cost);
    }
  }

  const totalEquityUsd = cashUsd + openExposureCostUsd;
  const netPnlUsd = totalEquityUsd - startingBudgetUsd;

  return {
    startingBudgetUsd,
    cashUsd,
    openExposureCostUsd,
    totalEquityUsd,
    netPnlUsd,
    realizedPnLUsd,
    totalFeesUsd,
    buyCount,
    sellCount,
    fillCount: trades.length,
  };
}

import { db, paperTrades, realTrades } from '@/lib/db';
import { gte, inArray, asc } from 'drizzle-orm';
import { getPaperBudgetSettings } from '@/lib/settings/paper-budget';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { buildEquityCurve } from '@/lib/paper/equity-curve';
import { computePaperLedger } from '@/lib/paper/ledger';
import { aggregatePaperPositions } from '@/lib/paper/positions';
import { computeMarkToMarket } from '@/lib/paper/mark-to-market';
import {
  getRunnerExecutionMode,
  isLiveExecutionMode,
  type RunnerExecutionMode,
} from '@/lib/runner/execution-mode';
import { getPolymarketPrivateKey, getPolymarketUsdcBalance } from '@/lib/clients/polymarket-trading';
import { getPolymarketSetupSnapshot } from '@/lib/clients/polymarket-trading-setup';
import type { LedgerTrade } from '@/lib/paper/ledger';

export interface ZenEquityPoint {
  t: number;
  equity: number;
  pnl: number;
}

export interface ZenEquitySnapshot {
  mode: RunnerExecutionMode;
  /** True when real Polymarket orders are active (live or mixed). */
  isLive: boolean;
  startingBudgetUsd: number;
  liveEquityUsd: number;
  netPnlUsd: number;
  realizedPnLUsd: number;
  unrealizedPnLUsd: number;
  fillCount: number;
  /** CLOB cash — live mode only */
  clobCashUsd?: number | null;
  points: ZenEquityPoint[];
}

const LIVE_TRADE_STATUSES = ['filled'] as const;

function inferLiveStartingBudget(clobCash: number, trades: LedgerTrade[]): number {
  if (trades.length === 0) return clobCash;
  let buySpend = 0;
  let sellProceeds = 0;
  for (const t of trades) {
    const size = parseFloat(t.size);
    const price = parseFloat(t.price);
    const fee = parseFloat(t.fee ?? '0');
    if (t.side === 'BUY') buySpend += size * price + fee;
    else sellProceeds += size * price - fee;
  }
  return clobCash + buySpend - sellProceeds;
}

async function getLiveClobBalance(): Promise<number | null> {
  const pk = getPolymarketPrivateKey();
  if (!pk) return null;
  const snap = getPolymarketSetupSnapshot();
  const balance =
    snap?.balanceUsd ?? (await getPolymarketUsdcBalance(pk, { syncFirst: false }));
  return balance ?? null;
}

async function getPaperZenSnapshot(): Promise<ZenEquitySnapshot> {
  const [budget, runStart] = await Promise.all([
    getPaperBudgetSettings(),
    getPaperRunStartedAt(),
  ]);

  const runFilter = runStart ? gte(paperTrades.filledAt, runStart) : undefined;
  const trades = await db.query.paperTrades.findMany({
    where: runFilter,
    orderBy: (t, { asc: ascOp }) => [ascOp(t.filledAt)],
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

  return {
    mode: 'paper',
    isLive: false,
    startingBudgetUsd: budget.paperBudgetUsd,
    liveEquityUsd: liveEquity,
    netPnlUsd: liveEquity - budget.paperBudgetUsd,
    realizedPnLUsd: ledger.realizedPnLUsd,
    unrealizedPnLUsd: mtm.unrealizedPnLUsd,
    fillCount: trades.length,
    points: curve.map((p) => ({ t: p.t, equity: p.equity, pnl: p.pnl })),
  };
}

async function getLiveZenSnapshot(mode: RunnerExecutionMode): Promise<ZenEquitySnapshot> {
  const rows = await db.query.realTrades.findMany({
    where: inArray(realTrades.status, [...LIVE_TRADE_STATUSES]),
    orderBy: [asc(realTrades.filledAt), asc(realTrades.createdAt)],
  });

  const clobCash = await getLiveClobBalance();
  const ledgerTrades: LedgerTrade[] = rows.map((t) => ({
    platform: t.platform,
    marketExternalId: t.marketExternalId,
    side: t.side,
    size: t.size,
    price: t.price,
    fee: t.fee,
  }));

  const startingBudgetUsd =
    clobCash != null ? inferLiveStartingBudget(clobCash, ledgerTrades) : 0;

  const curve = buildEquityCurve(
    startingBudgetUsd > 0 ? startingBudgetUsd : clobCash ?? 0,
    rows.map((t) => ({
      platform: t.platform,
      marketExternalId: t.marketExternalId,
      side: t.side,
      size: t.size,
      price: t.price,
      fee: t.fee,
      filledAt: t.filledAt ?? t.createdAt,
    })),
  );

  const positions = aggregatePaperPositions(rows);
  const ledger = computePaperLedger(
    startingBudgetUsd > 0 ? startingBudgetUsd : clobCash ?? 0,
    ledgerTrades,
  );
  const mtm = await computeMarkToMarket(positions);

  const cashUsd = clobCash ?? ledger.cashUsd;
  const liveEquity = cashUsd + mtm.openMarkValueUsd;
  const start = startingBudgetUsd > 0 ? startingBudgetUsd : liveEquity;

  curve.push({
    t: Date.now(),
    equity: liveEquity,
    pnl: liveEquity - start,
    cash: cashUsd,
    exposure: mtm.openMarkValueUsd,
  });

  return {
    mode,
    isLive: true,
    startingBudgetUsd: start,
    liveEquityUsd: liveEquity,
    netPnlUsd: liveEquity - start,
    realizedPnLUsd: ledger.realizedPnLUsd,
    unrealizedPnLUsd: mtm.unrealizedPnLUsd,
    fillCount: rows.length,
    clobCashUsd: clobCash,
    points: curve.map((p) => ({ t: p.t, equity: p.equity, pnl: p.pnl })),
  };
}

export async function getZenEquitySnapshot(): Promise<ZenEquitySnapshot> {
  const mode = await getRunnerExecutionMode();
  if (isLiveExecutionMode(mode)) {
    return getLiveZenSnapshot(mode);
  }
  return getPaperZenSnapshot();
}

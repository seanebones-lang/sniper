import { db, paperTrades, realTrades, strategies } from '@/lib/db';
import { gte, inArray, asc, and, eq } from 'drizzle-orm';
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
import { getPolymarketPrivateKey } from '@/lib/clients/polymarket-trading';
import { resolveLiveUsdcBalance } from '@/lib/clients/polymarket-trading-setup';
import { getRealOpenPositionsByStrategy } from '@/lib/execution/real-positions';
import {
  fetchLiveMarkPrices,
  inferLiveStartingBudget,
  realPositionsToPaperRows,
} from '@/lib/zen/live-equity';
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
  /** Open position mark value (live mode) */
  openExposureUsd?: number;
  points: ZenEquityPoint[];
}

const LIVE_TRADE_STATUSES = ['filled'] as const;

function toLedgerTrades(
  rows: Array<{
    platform: string;
    marketExternalId: string;
    side: string;
    size: string;
    price: string;
    fee: string | null;
  }>,
): LedgerTrade[] {
  return rows.map((t) => ({
    platform: t.platform,
    marketExternalId: t.marketExternalId,
    side: t.side,
    size: t.size,
    price: t.price,
    fee: t.fee,
  }));
}

async function getLiveClobBalance(): Promise<number | null> {
  const pk = getPolymarketPrivateKey();
  if (!pk) return null;
  return resolveLiveUsdcBalance(pk);
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
  const [rows, liveStrats, clobCash] = await Promise.all([
    db.query.realTrades.findMany({
      where: inArray(realTrades.status, [...LIVE_TRADE_STATUSES]),
      orderBy: [asc(realTrades.filledAt), asc(realTrades.createdAt)],
    }),
    db.query.strategies.findMany({
      where: and(eq(strategies.isActive, true), eq(strategies.paperOnly, false)),
      columns: { id: true },
    }),
    getLiveClobBalance(),
  ]);

  const ledgerTrades = toLedgerTrades(rows);

  const positionsByStrategy =
    liveStrats.length > 0
      ? await getRealOpenPositionsByStrategy(liveStrats.map((s) => s.id))
      : new Map<string, never[]>();
  const openRealPositions = Array.from(positionsByStrategy.values()).flat();
  const positionRows = realPositionsToPaperRows(openRealPositions);

  const markPrices = positionRows.length > 0 ? await fetchLiveMarkPrices(positionRows) : undefined;
  const mtm = await computeMarkToMarket(positionRows, markPrices);

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

  const cashUsd = clobCash ?? 0;
  const liveEquity = cashUsd + mtm.openMarkValueUsd;
  const start = startingBudgetUsd > 0 ? startingBudgetUsd : liveEquity;
  const netPnlUsd = liveEquity - start;
  const unrealizedPnLUsd = mtm.unrealizedPnLUsd;
  // Tie realized to authoritative wallet equity so footer stats always reconcile.
  const realizedPnLUsd = netPnlUsd - unrealizedPnLUsd;

  curve.push({
    t: Date.now(),
    equity: liveEquity,
    pnl: netPnlUsd,
    cash: cashUsd,
    exposure: mtm.openMarkValueUsd,
  });

  return {
    mode,
    isLive: true,
    startingBudgetUsd: start,
    liveEquityUsd: liveEquity,
    netPnlUsd,
    realizedPnLUsd,
    unrealizedPnLUsd,
    fillCount: rows.length,
    clobCashUsd: clobCash,
    openExposureUsd: mtm.openMarkValueUsd,
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

import { db, paperTrades, signals } from '@/lib/db';
import { chunkArray } from '@/lib/db/chunk-in-array';
import { gte, desc, inArray, count, and } from 'drizzle-orm';
import { getRunnerStatus } from '@/lib/runner/engine';
import { getPaperBudgetSettings } from '@/lib/settings/paper-budget';
import { getPaperRunStartedAt, getPaperPortfolioSince } from '@/lib/paper/run-session';
import { aggregatePaperPositions, totalExposureUsd, type PaperPositionRow } from '@/lib/paper/positions';
import { computePaperLedger, type PaperLedgerSummary } from '@/lib/paper/ledger';
import { computeMarkToMarket } from '@/lib/paper/mark-to-market';

export type { PaperPositionRow };

export interface PaperPnlSnapshot {
  computedAt: string;
  source: 'paper_trades_db';
  fillsInRun: number;
  buyFills: number;
  sellFills: number;
  startingBudgetUsd: number;
  cashUsd: number;
  openCostBasisUsd: number;
  openMarkValueUsd: number;
  realizedPnLUsd: number;
  unrealizedPnLUsd: number;
  totalEquityUsd: number;
  netPnlUsd: number;
  netPnlPct: number;
  totalFeesUsd: number;
  openPositions: number;
  positionsMarked: number;
  marksUpdatedAt: string;
}

export interface PaperFillRow {
  id: string;
  platform: string;
  marketExternalId: string;
  side: string;
  price: number;
  size: number;
  fee: number;
  filledAt: string;
  strategyName: string | null;
}

export interface StrategyPerformanceRow {
  strategyId: string;
  name: string;
  signals: number;
  fills: number;
  notionalUsd: number;
  isActive: boolean;
}

export interface PaperPortfolioSnapshot {
  runner: ReturnType<typeof getRunnerStatus> & {
    dbPaperFillsTotal: number;
    dbPaperFillsToday: number;
    activeStrategies: number;
    lastRunAgeSeconds: number | null;
  };
  budget: {
    paperBudgetUsd: number;
    maxExposureUsd: number;
    maxDailyLossUsd: number;
    totalExposureUsd: number;
    availableUsd: number;
    totalFeesUsd: number;
    utilizationPct: number;
    /** True cash balance (includes realized PnL from closed trades) */
    cashUsd: number;
    totalEquityUsd: number;
    netPnlUsd: number;
    netPnlPct: number;
  };
  positions: PaperPositionRow[];
  recentFills: PaperFillRow[];
  performance: {
    periodDays: number;
    totalSignals: number;
    totalFills: number;
    buyFills: number;
    sellFills: number;
    byStrategy: StrategyPerformanceRow[];
  };
  runSession: {
    startedAt: string | null;
    fillsInRun: number;
  };
  pnl: PaperPnlSnapshot;
  /** Present when SNIPER_ENABLE_REAL_EXECUTION=true — real wallet is separate from paper budget. */
  live?: {
    armed: boolean;
    polymarketUsdcBalance: number | null;
    polymarketReady: boolean;
    geoblockBlocked: boolean;
    note: string;
  };
}

export async function getPaperPortfolio(periodDays = 7): Promise<PaperPortfolioSnapshot> {
  const since = await getPaperPortfolioSince(periodDays);
  const runStart = await getPaperRunStartedAt();
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const runFilter = runStart ? gte(paperTrades.filledAt, runStart) : undefined;

  const [positionTrades, periodTrades, periodSignals, stratRows, budget, totalCountRow, todayCountRow] =
    await Promise.all([
      db.query.paperTrades.findMany({
        where: runFilter,
        orderBy: (t, { asc }) => [asc(t.filledAt)],
      }),
      db.query.paperTrades.findMany({
        where: gte(paperTrades.filledAt, since),
        orderBy: [desc(paperTrades.filledAt)],
        limit: 500,
      }),
      db.query.signals.findMany({ where: gte(signals.createdAt, since) }),
      db.query.strategies.findMany(),
      getPaperBudgetSettings(),
      db.select({ count: count() }).from(paperTrades).where(runFilter),
      db.select({ count: count() }).from(paperTrades).where(
        runStart
          ? and(gte(paperTrades.filledAt, todayStart), runFilter)
          : gte(paperTrades.filledAt, todayStart),
      ),
    ]);

  const allTrades = positionTrades;
  const dbPaperFillsTotal = totalCountRow[0]?.count ?? allTrades.length;
  const dbPaperFillsToday = todayCountRow[0]?.count ?? 0;

  const positions = aggregatePaperPositions(positionTrades);
  const exposure = totalExposureUsd(positions);
  const ledgerTrades = positionTrades.map((t) => ({
    platform: t.platform,
    marketExternalId: t.marketExternalId,
    side: t.side,
    size: t.size,
    price: t.price,
    fee: t.fee,
  }));
  const ledger: PaperLedgerSummary = computePaperLedger(budget.paperBudgetUsd, ledgerTrades);
  const mtm = await computeMarkToMarket(positions);
  const totalEquityUsd = ledger.cashUsd + mtm.openMarkValueUsd;
  const netPnlUsd = totalEquityUsd - budget.paperBudgetUsd;
  const netPnlPct = budget.paperBudgetUsd > 0 ? (netPnlUsd / budget.paperBudgetUsd) * 100 : 0;
  const totalFeesUsd = ledger.totalFeesUsd;

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
    netPnlPct,
    totalFeesUsd,
    openPositions: mtm.openPositionCount,
    positionsMarked: mtm.positionsMarked,
    marksUpdatedAt: mtm.markedAt,
  };

  const stratById = Object.fromEntries(stratRows.map((s) => [s.id, s]));
  const signalIds = periodTrades.map((t) => t.signalId).filter(Boolean) as string[];
  const linkedSignals: Array<{ id: string; strategyId: string }> = [];
  for (const ids of chunkArray(signalIds)) {
    const batch = await db.query.signals.findMany({
      where: inArray(signals.id, ids),
      columns: { id: true, strategyId: true },
    });
    linkedSignals.push(...batch);
  }
  const signalStrategyMap = Object.fromEntries(linkedSignals.map((s) => [s.id, s.strategyId]));

  const byStrategy: Record<string, StrategyPerformanceRow> = {};
  for (const s of stratRows) {
    byStrategy[s.id] = {
      strategyId: s.id,
      name: s.name,
      signals: 0,
      fills: 0,
      notionalUsd: 0,
      isActive: s.isActive,
    };
  }

  for (const sig of periodSignals) {
    if (!byStrategy[sig.strategyId]) {
      byStrategy[sig.strategyId] = {
        strategyId: sig.strategyId,
        name: stratById[sig.strategyId]?.name ?? 'Unknown',
        signals: 0,
        fills: 0,
        notionalUsd: 0,
        isActive: stratById[sig.strategyId]?.isActive ?? false,
      };
    }
    byStrategy[sig.strategyId].signals++;
  }

  for (const fill of periodTrades) {
    const strategyId = fill.signalId ? signalStrategyMap[fill.signalId] : null;
    if (strategyId && byStrategy[strategyId]) {
      byStrategy[strategyId].fills++;
      byStrategy[strategyId].notionalUsd += parseFloat(fill.size) * parseFloat(fill.price);
    }
  }

  const recentFills: PaperFillRow[] = periodTrades.slice(0, 30).map((t) => {
    const strategyId = t.signalId ? signalStrategyMap[t.signalId] : null;
    return {
      id: t.id,
      platform: t.platform,
      marketExternalId: t.marketExternalId,
      side: t.side,
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      fee: parseFloat(t.fee ?? '0'),
      filledAt: t.filledAt.toISOString(),
      strategyName: strategyId ? (stratById[strategyId]?.name ?? null) : null,
    };
  });

  const runner = getRunnerStatus();
  const activeStrategies = stratRows.filter((s) => s.isActive).length;

  const performanceRows = Object.values(byStrategy)
    .filter((s) => s.isActive || s.signals > 0 || s.fills > 0)
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.fills - a.fills;
    });

  let live: PaperPortfolioSnapshot['live'];
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    try {
      const { getRealExecutionStatus } = await import('@/lib/execution/real-executor');
      const { getPolymarketPrivateKey, getPolymarketUsdcBalance } = await import(
        '@/lib/clients/polymarket-trading'
      );
      const { ensurePolymarketTradingReady } = await import(
        '@/lib/clients/polymarket-trading-setup'
      );
      const realStatus = await getRealExecutionStatus();
      const pk = getPolymarketPrivateKey();
      let polymarketUsdcBalance: number | null = null;
      let polymarketReady = false;
      if (pk) {
        const setup = await ensurePolymarketTradingReady();
        polymarketReady = setup.ready;
        polymarketUsdcBalance =
          setup.balanceUsd ?? (await getPolymarketUsdcBalance(pk, { syncFirst: false }));
      }
      live = {
        armed: realStatus.allowed,
        polymarketUsdcBalance,
        polymarketReady,
        geoblockBlocked: realStatus.geoblock?.blocked === true,
        note: 'Paper bankroll below is simulation only. Live orders use Polymarket CLOB cash.',
      };
    } catch {
      live = {
        armed: false,
        polymarketUsdcBalance: null,
        polymarketReady: false,
        geoblockBlocked: false,
        note: 'Live status unavailable',
      };
    }
  }

  return {
    runner: {
      ...runner,
      dbPaperFillsTotal,
      dbPaperFillsToday,
      activeStrategies,
      lastRunAgeSeconds: runner.lastRun
        ? Math.round((Date.now() - new Date(runner.lastRun).getTime()) / 1000)
        : null,
    },
    live,
    budget: {
      paperBudgetUsd: budget.paperBudgetUsd,
      maxExposureUsd: budget.maxExposureUsd,
      maxDailyLossUsd: budget.maxDailyLossUsd,
      totalExposureUsd: mtm.openMarkValueUsd,
      availableUsd: Math.max(0, ledger.cashUsd),
      cashUsd: ledger.cashUsd,
      totalEquityUsd,
      netPnlUsd,
      netPnlPct,
      totalFeesUsd,
      utilizationPct: budget.maxExposureUsd > 0
        ? Math.min(100, (mtm.openMarkValueUsd / budget.maxExposureUsd) * 100)
        : 0,
    },
    positions,
    recentFills,
    performance: {
      periodDays,
      totalSignals: periodSignals.length,
      totalFills: periodTrades.length,
      buyFills: periodTrades.filter((t) => t.side === 'BUY').length,
      sellFills: periodTrades.filter((t) => t.side === 'SELL').length,
      byStrategy: performanceRows,
    },
    runSession: {
      startedAt: runStart?.toISOString() ?? null,
      fillsInRun: runStart ? (totalCountRow[0]?.count ?? 0) : 0,
    },
    pnl,
  };
}

export async function applyPaperBudgetToRiskManager() {
  const budget = await getPaperBudgetSettings();
  const { applyPaperBudgetToPortfolioManager } = await import('@/lib/risk/portfolio-manager');
  applyPaperBudgetToPortfolioManager(budget);
}

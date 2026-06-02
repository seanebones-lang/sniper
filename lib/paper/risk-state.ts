import { db, paperTrades } from '@/lib/db';
import { and, count, gt, gte } from 'drizzle-orm';
import { getPaperBudgetSettings } from '@/lib/settings/paper-budget';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { aggregatePaperPositions } from '@/lib/paper/positions';
import { computePaperLedger, type PaperLedgerSummary } from '@/lib/paper/ledger';
import { computeMarkToMarket, type MarkPriceMap } from '@/lib/paper/mark-to-market';
import { categorizeMarket } from '@/lib/risk/categorizer';
import type { PortfolioState } from '@/lib/risk/portfolio-manager';

export interface PaperRiskSnapshot {
  state: PortfolioState;
  equityUsd: number;
  cashUsd: number;
  startingBudgetUsd: number;
  ledger: PaperLedgerSummary;
}

let ledgerCache: {
  fillCount: number;
  runStartIso: string | null;
  trades: Awaited<ReturnType<typeof db.query.paperTrades.findMany>>;
  ledger: PaperLedgerSummary;
  positions: ReturnType<typeof aggregatePaperPositions>;
  budgetUsd: number;
  lastFilledAt: Date | null;
} | null = null;

const MAX_INCREMENTAL_FILLS = 80;

export function invalidatePaperRiskCache(): void {
  ledgerCache = null;
}

function toLedgerTrades(
  trades: Array<{
    platform: string;
    marketExternalId: string;
    side: string;
    size: string;
    price: string;
    fee: string | null;
  }>,
) {
  return trades.map((t) => ({
    platform: t.platform,
    marketExternalId: t.marketExternalId,
    side: t.side,
    size: t.size,
    price: t.price,
    fee: t.fee,
  }));
}

/** Build portfolio risk state from paper_trades (ledger + optional live marks). */
export async function loadPaperRiskState(markPrices?: MarkPriceMap): Promise<PaperRiskSnapshot> {
  const [budget, runStart] = await Promise.all([
    getPaperBudgetSettings(),
    getPaperRunStartedAt(),
  ]);

  const runFilter = runStart ? gte(paperTrades.filledAt, runStart) : undefined;
  const runStartIso = runStart?.toISOString() ?? null;

  const [{ value: fillCount }] = await db
    .select({ value: count() })
    .from(paperTrades)
    .where(runFilter ?? undefined);

  let trades = ledgerCache?.trades;
  let ledger = ledgerCache?.ledger;
  let positions = ledgerCache?.positions;

  const cacheValid =
    ledgerCache &&
    ledgerCache.runStartIso === runStartIso &&
    ledgerCache.budgetUsd === budget.paperBudgetUsd;

  const delta = cacheValid ? fillCount - ledgerCache!.fillCount : fillCount;

  if (cacheValid && delta === 0) {
    // use cached trades/ledger/positions
  } else if (
    cacheValid &&
    delta > 0 &&
    delta <= MAX_INCREMENTAL_FILLS &&
    ledgerCache!.lastFilledAt
  ) {
    const newRows = await db.query.paperTrades.findMany({
      where: runFilter
        ? and(runFilter, gt(paperTrades.filledAt, ledgerCache!.lastFilledAt!))
        : gt(paperTrades.filledAt, ledgerCache!.lastFilledAt!),
      orderBy: (t, { asc }) => [asc(t.filledAt)],
    });
    trades = [...ledgerCache!.trades, ...newRows];
    const ledgerTrades = toLedgerTrades(trades);
    ledger = computePaperLedger(budget.paperBudgetUsd, ledgerTrades);
    positions = aggregatePaperPositions(trades);
    ledgerCache = {
      fillCount,
      runStartIso,
      trades,
      ledger,
      positions,
      budgetUsd: budget.paperBudgetUsd,
      lastFilledAt: trades[trades.length - 1]?.filledAt ?? ledgerCache!.lastFilledAt,
    };
  } else {
    trades = await db.query.paperTrades.findMany({
      where: runFilter,
      orderBy: (t, { asc }) => [asc(t.filledAt)],
    });
    const ledgerTrades = toLedgerTrades(trades);
    ledger = computePaperLedger(budget.paperBudgetUsd, ledgerTrades);
    positions = aggregatePaperPositions(trades);
    ledgerCache = {
      fillCount,
      runStartIso,
      trades,
      ledger,
      positions,
      budgetUsd: budget.paperBudgetUsd,
      lastFilledAt: trades[trades.length - 1]?.filledAt ?? null,
    };
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const tradesBeforeToday = trades!.filter((t) => t.filledAt < todayStart);
  const ledgerStartOfDay = computePaperLedger(
    budget.paperBudgetUsd,
    toLedgerTrades(tradesBeforeToday),
  );
  const positionsStartOfDay = aggregatePaperPositions(tradesBeforeToday);
  const startOfDayExposure = positionsStartOfDay.reduce((sum, p) => sum + p.notionalUsd, 0);

  const mtm = await computeMarkToMarket(positions!, markPrices);
  const equityUsd = ledger!.cashUsd + mtm.openMarkValueUsd;
  const equityStartOfDay = ledgerStartOfDay.cashUsd + startOfDayExposure;
  const dailyPnl = equityUsd - equityStartOfDay;

  const categoryExposures: Record<string, number> = {};
  for (const p of positions!) {
    const cat = categorizeMarket('', p.platform, p.marketExternalId).category;
    const markKey = `${p.platform}:${p.marketExternalId}`;
    const mark = markPrices?.get(markKey);
    const valueUsd = mark != null && mark > 0 ? Math.abs(p.netSize) * mark : p.notionalUsd;
    categoryExposures[cat] = (categoryExposures[cat] || 0) + valueUsd;
  }

  const state: PortfolioState = {
    totalExposureUsd: mtm.openMarkValueUsd,
    dailyPnl,
    maxDrawdown: 0,
    openPositions: mtm.openPositionCount,
    categoryExposures,
  };

  return {
    state,
    equityUsd,
    cashUsd: ledger!.cashUsd,
    startingBudgetUsd: budget.paperBudgetUsd,
    ledger: ledger!,
  };
}

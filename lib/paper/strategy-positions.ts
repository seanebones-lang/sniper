import { db, paperTrades, signals } from '@/lib/db';
import { eq, gte, and } from 'drizzle-orm';
import type { StrategyOpenPosition } from '@/lib/strategies/exit-engine';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';

/**
 * Open positions for one strategy, derived from paper_trades joined to signals.
 */
export async function getStrategyOpenPositions(strategyId: string): Promise<StrategyOpenPosition[]> {
  const runStart = await getPaperRunStartedAt();

  const rows = await db
    .select({
      platform: paperTrades.platform,
      marketExternalId: paperTrades.marketExternalId,
      side: paperTrades.side,
      size: paperTrades.size,
      price: paperTrades.price,
      filledAt: paperTrades.filledAt,
    })
    .from(paperTrades)
    .innerJoin(signals, eq(paperTrades.signalId, signals.id))
    .where(
      runStart
        ? and(eq(signals.strategyId, strategyId), gte(paperTrades.filledAt, runStart))
        : eq(signals.strategyId, strategyId),
    )
    .orderBy(paperTrades.filledAt);

  const byMarket = new Map<string, {
    platform: string;
    marketExternalId: string;
    netSize: number;
    costBasis: number;
    openedAt: Date | null;
  }>();

  for (const row of rows) {
    const key = `${row.platform}:${row.marketExternalId}`;
    const size = parseFloat(row.size);
    const price = parseFloat(row.price);
    const state = byMarket.get(key) ?? {
      platform: row.platform,
      marketExternalId: row.marketExternalId,
      netSize: 0,
      costBasis: 0,
      openedAt: null,
    };

    const prevNet = state.netSize;

    if (row.side === 'BUY') {
      state.costBasis += size * price;
      state.netSize += size;
      if (prevNet <= 0.01 && state.netSize > 0.01) {
        state.openedAt = row.filledAt;
      }
    } else {
      const avg = state.netSize > 0.01 ? state.costBasis / state.netSize : price;
      state.netSize -= size;
      state.costBasis -= avg * size;
      if (state.netSize <= 0.01) {
        state.openedAt = null;
        state.costBasis = 0;
        state.netSize = 0;
      }
    }

    byMarket.set(key, state);
  }

  return Array.from(byMarket.values())
    .filter((p) => p.netSize > 0.01 && p.openedAt)
    .map((p) => ({
      platform: p.platform,
      marketExternalId: p.marketExternalId,
      netSize: p.netSize,
      avgEntryPrice: p.costBasis / p.netSize,
      openedAt: p.openedAt!,
      strategyId,
    }));
}

/**
 * Hydrate in-memory paper simulator from DB so sells respect open size.
 */
export async function hydratePaperSimulatorFromDb() {
  const { paperSimulator } = await import('@/lib/execution/paper-simulator');
  const runStart = await getPaperRunStartedAt();

  const trades = await db.query.paperTrades.findMany({
    where: runStart ? gte(paperTrades.filledAt, runStart) : undefined,
    orderBy: (t, { asc }) => [asc(t.filledAt)],
  });

  paperSimulator.reset();
  for (const t of trades) {
    paperSimulator.snipe({
      market: {
        id: t.marketExternalId,
        platform: t.platform as 'polymarket' | 'kalshi',
        externalId: t.marketExternalId,
        question: t.marketExternalId,
        status: 'open',
        updatedAt: t.filledAt.toISOString(),
      },
      side: t.side as 'BUY' | 'SELL',
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      reason: 'hydrate from DB',
      immediate: true,
    });
  }
}

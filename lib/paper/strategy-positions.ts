import { db, paperTrades, signals } from '@/lib/db';
import { eq, gte, and, inArray } from 'drizzle-orm';
import type { StrategyOpenPosition } from '@/lib/strategies/exit-engine';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';

/**
 * Open positions for one strategy, derived from paper_trades joined to signals.
 */
export async function getStrategyOpenPositions(strategyId: string): Promise<StrategyOpenPosition[]> {
  const map = await getOpenPositionsByStrategy([strategyId]);
  return map.get(strategyId) ?? [];
}

function aggregateOpenPositions(
  rows: Array<{
    platform: string;
    marketExternalId: string;
    side: string;
    size: string;
    price: string;
    filledAt: Date;
  }>,
  strategyId: string,
): StrategyOpenPosition[] {
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

/** Batch-load open positions for many strategies in one DB query. */
export async function getOpenPositionsByStrategy(
  strategyIds: string[],
): Promise<Map<string, StrategyOpenPosition[]>> {
  const result = new Map<string, StrategyOpenPosition[]>();
  if (strategyIds.length === 0) return result;

  for (const id of strategyIds) {
    result.set(id, []);
  }

  const runStart = await getPaperRunStartedAt();
  const rows = await db
    .select({
      strategyId: signals.strategyId,
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
        ? and(inArray(signals.strategyId, strategyIds), gte(paperTrades.filledAt, runStart))
        : inArray(signals.strategyId, strategyIds),
    )
    .orderBy(paperTrades.filledAt);

  const byStrategy = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byStrategy.get(row.strategyId) ?? [];
    bucket.push(row);
    byStrategy.set(row.strategyId, bucket);
  }

  for (const strategyId of strategyIds) {
    const stratRows = byStrategy.get(strategyId) ?? [];
    result.set(strategyId, aggregateOpenPositions(stratRows, strategyId));
  }

  return result;
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

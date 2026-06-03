import { db, realTrades, signals } from '@/lib/db';
import { and, eq, gte, inArray } from 'drizzle-orm';
import type { StrategyOpenPosition } from '@/lib/strategies/exit-engine';

/**
 * Open REAL positions per strategy, derived from filled `real_trades` joined to
 * `signals` (for strategy attribution). This is the live-money analogue of
 * `getOpenPositionsByStrategy` (paper) and is what wires real fills into the
 * runner's exit loop so take-profit / stop-loss / max-hold actually fire.
 *
 * Requires `real_trades.signalId` to be set on insert (see real-executor).
 * Legacy rows without a signalId cannot be attributed and are ignored here.
 */

/** Only consider recent real trades — open positions for short-hold strategies are never old. */
const REAL_POSITION_LOOKBACK_MS = 7 * 24 * 3600 * 1000;

export function aggregateRealPositions(
  rows: Array<{
    platform: string;
    marketExternalId: string;
    side: string;
    size: string;
    price: string;
    at: Date;
  }>,
  strategyId: string,
): StrategyOpenPosition[] {
  const byMarket = new Map<
    string,
    {
      platform: string;
      marketExternalId: string;
      netSize: number;
      costBasis: number;
      openedAt: Date | null;
    }
  >();

  for (const row of rows) {
    const key = `${row.platform}:${row.marketExternalId}`;
    const size = parseFloat(row.size);
    const price = parseFloat(row.price);
    if (!Number.isFinite(size) || !Number.isFinite(price)) continue;

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
        state.openedAt = row.at;
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

/** Batch-load open real positions for many strategies in one DB query. */
export async function getRealOpenPositionsByStrategy(
  strategyIds: string[],
): Promise<Map<string, StrategyOpenPosition[]>> {
  const result = new Map<string, StrategyOpenPosition[]>();
  if (strategyIds.length === 0) return result;
  for (const id of strategyIds) result.set(id, []);

  const since = new Date(Date.now() - REAL_POSITION_LOOKBACK_MS);

  const rows = await db
    .select({
      strategyId: signals.strategyId,
      platform: realTrades.platform,
      marketExternalId: realTrades.marketExternalId,
      side: realTrades.side,
      size: realTrades.size,
      price: realTrades.price,
      filledAt: realTrades.filledAt,
      createdAt: realTrades.createdAt,
    })
    .from(realTrades)
    .innerJoin(signals, eq(realTrades.signalId, signals.id))
    .where(
      and(
        inArray(signals.strategyId, strategyIds),
        eq(realTrades.status, 'filled'),
        gte(realTrades.createdAt, since),
      ),
    )
    .orderBy(realTrades.createdAt);

  const byStrategy = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = byStrategy.get(row.strategyId) ?? [];
    bucket.push(row);
    byStrategy.set(row.strategyId, bucket);
  }

  for (const strategyId of strategyIds) {
    const stratRows = (byStrategy.get(strategyId) ?? []).map((r) => ({
      platform: r.platform,
      marketExternalId: r.marketExternalId,
      side: r.side,
      size: r.size,
      price: r.price,
      at: r.filledAt ?? r.createdAt,
    }));
    result.set(strategyId, aggregateRealPositions(stratRows, strategyId));
  }

  return result;
}

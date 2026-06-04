import { db, realTrades, signals } from '@/lib/db';
import { and, eq, gte, inArray, or, isNotNull, ne, isNull } from 'drizzle-orm';
import type { StrategyOpenPosition } from '@/lib/strategies/exit-engine';
import {
  isDeadMarketToken,
  isDustOpenPosition,
  isLegacyPennyPosition,
} from '@/lib/execution/dead-market-tokens';

/**
 * Open REAL positions per strategy, derived from exchange-confirmed or
 * attributable `real_trades` joined to `signals`.
 *
 * Includes `filled`, `needs_review`, and `pending` BUYs with a real order id
 * so the exit loop can manage live holdings while reconciliation catches up.
 */

/** Only consider recent real trades — open positions for short-hold strategies are never old. */
const REAL_POSITION_LOOKBACK_MS = 7 * 24 * 3600 * 1000;

export type AggregateRealPositionsOptions = {
  /** When false, include dust/dead/legacy rows (for self-heal ledger sync). */
  applyFilters?: boolean;
};

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
  options?: AggregateRealPositionsOptions,
): StrategyOpenPosition[] {
  const applyFilters = options?.applyFilters !== false;
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

  let open = Array.from(byMarket.values()).filter((p) => p.netSize > 0.01 && p.openedAt);
  if (applyFilters) {
    open = open
      .filter((p) => !isDeadMarketToken(p.marketExternalId))
      .filter((p) => !isLegacyPennyPosition(p.costBasis / p.netSize, p.netSize))
      .filter((p) => !isDustOpenPosition(p.netSize, p.costBasis / p.netSize));
  }
  return open.map((p) => ({
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
        gte(realTrades.createdAt, since),
        or(
          inArray(realTrades.status, ['filled', 'needs_review']),
          and(
            eq(realTrades.status, 'pending'),
            eq(realTrades.side, 'BUY'),
            isNotNull(realTrades.txHash),
            ne(realTrades.txHash, 'submitted'),
          ),
        ),
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
    result.set(strategyId, aggregateRealPositions(stratRows, strategyId, { applyFilters: true }));
  }

  // Orphan BUY/SELL rows (no signalId) — attribute to the sole live strategy when unambiguous.
  if (strategyIds.length === 1) {
    const orphanRows = await db
      .select({
        platform: realTrades.platform,
        marketExternalId: realTrades.marketExternalId,
        side: realTrades.side,
        size: realTrades.size,
        price: realTrades.price,
        filledAt: realTrades.filledAt,
        createdAt: realTrades.createdAt,
      })
      .from(realTrades)
      .where(
        and(
          isNull(realTrades.signalId),
          gte(realTrades.createdAt, since),
          or(
            inArray(realTrades.status, ['filled', 'needs_review']),
            and(
              eq(realTrades.status, 'pending'),
              eq(realTrades.side, 'BUY'),
              isNotNull(realTrades.txHash),
              ne(realTrades.txHash, 'submitted'),
            ),
          ),
        ),
      )
      .orderBy(realTrades.createdAt);

    if (orphanRows.length > 0) {
      const strategyId = strategyIds[0];
      const joinedLedger = (byStrategy.get(strategyId) ?? []).map((r) => ({
        platform: r.platform,
        marketExternalId: r.marketExternalId,
        side: r.side,
        size: r.size,
        price: r.price,
        at: r.filledAt ?? r.createdAt,
      }));
      const orphanLedger = orphanRows.map((r) => ({
        platform: r.platform,
        marketExternalId: r.marketExternalId,
        side: r.side,
        size: r.size,
        price: r.price,
        at: r.filledAt ?? r.createdAt,
      }));
      result.set(
        strategyId,
        aggregateRealPositions([...joinedLedger, ...orphanLedger], strategyId, { applyFilters: true }),
      );
    }
  }

  return result;
}

/** Unfiltered ledger positions for automated heal (ghost/dust/dead write-offs). */
export async function getRealOpenPositionsForHeal(
  strategyIds: string[],
): Promise<Map<string, StrategyOpenPosition[]>> {
  if (strategyIds.length === 0) return new Map();

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
        gte(realTrades.createdAt, since),
        or(
          inArray(realTrades.status, ['filled', 'needs_review']),
          and(
            eq(realTrades.status, 'pending'),
            eq(realTrades.side, 'BUY'),
            isNotNull(realTrades.txHash),
            ne(realTrades.txHash, 'submitted'),
          ),
        ),
      ),
    )
    .orderBy(realTrades.createdAt);

  const result = new Map<string, StrategyOpenPosition[]>();
  for (const id of strategyIds) result.set(id, []);

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
    result.set(strategyId, aggregateRealPositions(stratRows, strategyId, { applyFilters: false }));
  }

  if (strategyIds.length === 1) {
    const orphanRows = await db
      .select({
        platform: realTrades.platform,
        marketExternalId: realTrades.marketExternalId,
        side: realTrades.side,
        size: realTrades.size,
        price: realTrades.price,
        filledAt: realTrades.filledAt,
        createdAt: realTrades.createdAt,
      })
      .from(realTrades)
      .where(
        and(
          isNull(realTrades.signalId),
          gte(realTrades.createdAt, since),
          or(
            inArray(realTrades.status, ['filled', 'needs_review']),
            and(
              eq(realTrades.status, 'pending'),
              eq(realTrades.side, 'BUY'),
              isNotNull(realTrades.txHash),
              ne(realTrades.txHash, 'submitted'),
            ),
          ),
        ),
      )
      .orderBy(realTrades.createdAt);

    if (orphanRows.length > 0) {
      const strategyId = strategyIds[0];
      const joinedLedger = (byStrategy.get(strategyId) ?? []).map((r) => ({
        platform: r.platform,
        marketExternalId: r.marketExternalId,
        side: r.side,
        size: r.size,
        price: r.price,
        at: r.filledAt ?? r.createdAt,
      }));
      const orphanLedger = orphanRows.map((r) => ({
        platform: r.platform,
        marketExternalId: r.marketExternalId,
        side: r.side,
        size: r.size,
        price: r.price,
        at: r.filledAt ?? r.createdAt,
      }));
      result.set(
        strategyId,
        aggregateRealPositions([...joinedLedger, ...orphanLedger], strategyId, { applyFilters: false }),
      );
    }
  }

  return result;
}

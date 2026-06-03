/**
 * Historical snapshot storage + strategy replay on collected order book data.
 */

import { and, asc, desc, eq, gte, lte, or } from 'drizzle-orm';
import { db, marketSnapshots } from '@/lib/db';
import type { BacktestResult } from '@/lib/backtest/engine';
import type { Strategy, StrategyConfig } from '@/lib/strategies/types';
import type { Market, OrderBook } from '@/lib/types';
import { normalizeOrderBookLevels } from '@/lib/orderbook';
import { resolveStrategyConfig } from '@/lib/strategies/run-profile';
import { evaluateExitSignal, type StrategyOpenPosition } from '@/lib/strategies/exit-engine';
import { isQuickFlipCandidate } from '@/lib/markets/fast-moving';

export interface BookSnapshotInput {
  platform: string;
  marketExternalId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  mid: number;
  spread: number;
  timestamp: Date;
  imbalance?: number;
  topDepth?: number;
  extra?: {
    regime?: string;
    volatilityProxy?: number;
    imbalancePersistence?: number;
  };
}

export interface ReplayResult extends BacktestResult {
  snapshotCount: number;
  message?: string;
}

function toNumber(value: string | number | null | undefined): number | undefined {
  if (value == null) return undefined;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isNaN(n) ? undefined : n;
}

function snapshotToBook(row: typeof marketSnapshots.$inferSelect): OrderBook | null {
  const topLevels = row.topLevels as { bids?: Array<{ price: number; size: number }>; asks?: Array<{ price: number; size: number }> } | null;
  const bids = topLevels?.bids ?? [];
  const asks = topLevels?.asks ?? [];

  if (!bids.length && !asks.length) {
    const bestBid = toNumber(row.bestBid);
    const bestAsk = toNumber(row.bestAsk);
    if (bestBid == null && bestAsk == null) return null;

    return {
      platform: row.platform as Market['platform'],
      marketExternalId: row.marketExternalId,
      bids: bestBid != null ? [{ price: bestBid, size: toNumber(row.bidSizeTop) ?? 0 }] : [],
      asks: bestAsk != null ? [{ price: bestAsk, size: toNumber(row.askSizeTop) ?? 0 }] : [],
      mid: toNumber(row.mid),
      spread: toNumber(row.spread),
      timestamp: row.timestamp.toISOString(),
    };
  }

  const { bids: sortedBids, asks: sortedAsks, mid, spread } = normalizeOrderBookLevels(bids, asks);

  return {
    platform: row.platform as Market['platform'],
    marketExternalId: row.marketExternalId,
    bids: sortedBids,
    asks: sortedAsks,
    mid: mid ?? toNumber(row.mid),
    spread: spread ?? toNumber(row.spread),
    timestamp: row.timestamp.toISOString(),
  };
}

export async function saveBookSnapshot(input: BookSnapshotInput): Promise<void> {
  const { bids: sortedBids, asks: sortedAsks } = normalizeOrderBookLevels(input.bids, input.asks);
  const bestBid = sortedBids[0];
  const bestAsk = sortedAsks[0];
  const totalBidDepth = sortedBids.reduce((sum, b) => sum + b.size, 0);
  const totalAskDepth = sortedAsks.reduce((sum, a) => sum + a.size, 0);
  const depthSum = totalBidDepth + totalAskDepth;
  const imbalance =
    input.imbalance ??
    (depthSum > 0 ? (totalBidDepth - totalAskDepth) / depthSum : 0);

  const microPrice =
    bestBid && bestAsk
      ? (bestBid.price * bestAsk.size + bestAsk.price * bestBid.size) / (bestBid.size + bestAsk.size + 0.0001)
      : input.mid;

  try {
    await db.insert(marketSnapshots).values({
      platform: input.platform,
      marketExternalId: input.marketExternalId,
      timestamp: input.timestamp,
      mid: input.mid.toString(),
      spread: input.spread.toString(),
      lastPrice: input.mid.toString(),
      bestBid: bestBid ? bestBid.price.toString() : null,
      bestAsk: bestAsk ? bestAsk.price.toString() : null,
      bidSizeTop: bestBid ? bestBid.size.toString() : null,
      askSizeTop: bestAsk ? bestAsk.size.toString() : null,
      totalBidDepth: totalBidDepth.toString(),
      totalAskDepth: totalAskDepth.toString(),
      imbalance: imbalance.toString(),
      microPrice: microPrice.toString(),
      pressure: (input.extra?.volatilityProxy ?? 0).toString(),
      topLevels: {
        bids: sortedBids.slice(0, 5),
        asks: sortedAsks.slice(0, 5),
        extra: input.extra ?? {},
      },
    }).onConflictDoNothing();
  } catch (err) {
    console.warn('[historical] Failed to save snapshot:', err);
  }
}

export async function getRecentSnapshotsForMarket(
  platform: string,
  marketExternalId: string,
  limit = 10,
) {
  return db.query.marketSnapshots.findMany({
    where: and(
      eq(marketSnapshots.platform, platform),
      eq(marketSnapshots.marketExternalId, marketExternalId),
    ),
    orderBy: desc(marketSnapshots.timestamp),
    limit,
  });
}

type SnapshotRow = Awaited<ReturnType<typeof getRecentSnapshotsForMarket>>[number];

/** Batch-load recent snapshots for many markets (one query, grouped client-side). */
export async function getRecentSnapshotsBatch(
  keys: Array<{ platform: string; marketExternalId: string }>,
  limitPerMarket = 8,
): Promise<Map<string, SnapshotRow[]>> {
  const result = new Map<string, SnapshotRow[]>();
  if (keys.length === 0) return result;

  const unique = [...new Map(keys.map((k) => [`${k.platform}:${k.marketExternalId}`, k])).values()];
  for (const k of unique) {
    result.set(`${k.platform}:${k.marketExternalId}`, []);
  }

  const rows = await db.query.marketSnapshots.findMany({
    where: or(
      ...unique.map((k) =>
        and(
          eq(marketSnapshots.platform, k.platform),
          eq(marketSnapshots.marketExternalId, k.marketExternalId),
        ),
      ),
    ),
    orderBy: desc(marketSnapshots.timestamp),
    limit: unique.length * limitPerMarket,
  });

  for (const row of rows) {
    const key = `${row.platform}:${row.marketExternalId}`;
    const bucket = result.get(key);
    if (!bucket || bucket.length >= limitPerMarket) continue;
    bucket.push(row);
  }

  return result;
}

export async function getSnapshotsForReplay(
  platform: string,
  marketExternalId: string,
  from: Date,
  to: Date,
) {
  return db.query.marketSnapshots.findMany({
    where: and(
      eq(marketSnapshots.platform, platform),
      eq(marketSnapshots.marketExternalId, marketExternalId),
      gte(marketSnapshots.timestamp, from),
      lte(marketSnapshots.timestamp, to),
    ),
    orderBy: asc(marketSnapshots.timestamp),
    limit: 5000,
  });
}

export async function replayStrategyOnHistory(params: {
  platform: string;
  marketExternalId: string;
  from: Date;
  to: Date;
  strategy: Strategy;
  config: StrategyConfig;
  realisticPassiveFills?: boolean;
}): Promise<ReplayResult> {
  const snapshots = await getSnapshotsForReplay(
    params.platform,
    params.marketExternalId,
    params.from,
    params.to,
  );

  if (!snapshots.length) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      totalPnl: 0,
      maxDrawdown: 0,
      trades: [],
      snapshotCount: 0,
      message: 'No historical snapshots in range. Run the 24/7 runner to collect data.',
    };
  }

  const market: Market = {
    id: params.marketExternalId,
    platform: params.platform as Market['platform'],
    externalId: params.marketExternalId,
    question: `${params.platform} ${params.marketExternalId}`,
    status: 'open',
    updatedAt: new Date().toISOString(),
  };

  const resolvedConfig = resolveStrategyConfig(params.config);

  const trades: BacktestResult['trades'] = [];
  let openPosition: StrategyOpenPosition | null = null;
  let peak = 0;
  let maxDrawdown = 0;
  let pnl = 0;
  let lastSignalAt = 0;

  for (const row of snapshots) {
    const book = snapshotToBook(row);
    const currentPrice = toNumber(row.mid) ?? toNumber(row.lastPrice) ?? book?.mid;
    if (currentPrice == null) continue;

    const ts = row.timestamp.getTime();
    let signal = null;

    if (openPosition) {
      signal = evaluateExitSignal(
        openPosition,
        currentPrice,
        book?.spread,
        book?.mid ?? currentPrice,
        resolvedConfig,
        ts,
      );
    }

    if (!signal || signal.action === 'HOLD') {
      if (resolvedConfig.liveMarketsOnly && !isQuickFlipCandidate(market)) {
        continue;
      }
      if (openPosition && !resolvedConfig.allowScaleIn) {
        continue;
      }
      signal = params.strategy.evaluate(
        { market, book: book ?? undefined, currentPrice },
        resolvedConfig,
      );
    }

    if (!signal || signal.action === 'HOLD') continue;

    const cooldownMs = (resolvedConfig.cooldownSeconds ?? 300) * 1000;
    if (signal.action === 'BUY' && ts - lastSignalAt < cooldownMs) continue;

    if (signal.action === 'BUY' && (!openPosition || resolvedConfig.allowScaleIn)) {
      if (openPosition) {
        continue;
      }
      if (params.realisticPassiveFills) {
        const topAsk = book?.asks?.[0];
        const topBid = book?.bids?.[0];
        if (!topAsk || topAsk.size < signal.size) continue;
        const mid = book?.mid ?? currentPrice;
        const spreadPct =
          mid && mid > 0 && book?.spread != null ? (book.spread / mid) * 100 : 100;
        if (spreadPct > 15) continue;
        if (!topBid || topBid.size < signal.size * 0.5) continue;
      }
      openPosition = {
        platform: params.platform,
        marketExternalId: params.marketExternalId,
        netSize: signal.size,
        avgEntryPrice: signal.price,
        openedAt: row.timestamp,
        strategyId: 'replay',
      };
      trades.push({ price: signal.price, side: 'BUY', reason: signal.reason });
      lastSignalAt = ts;
    } else if (signal.action === 'SELL' && openPosition) {
      const tradePnl = (signal.price - openPosition.avgEntryPrice) * openPosition.netSize;
      pnl += tradePnl;
      trades.push({ price: signal.price, side: 'SELL', pnl: tradePnl, reason: signal.reason });

      const equity = pnl;
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDrawdown) maxDrawdown = dd;

      openPosition = null;
      lastSignalAt = ts;
    }
  }

  const winningTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;

  return {
    totalTrades: trades.length,
    winningTrades,
    totalPnl: pnl,
    maxDrawdown,
    trades,
    snapshotCount: snapshots.length,
  };
}

/**
 * Live trading ops snapshot for /real dashboard.
 */
import { db, realTrades } from '@/lib/db';
import { eq, desc, sql } from 'drizzle-orm';
import { getRealOpenPositionsByStrategy } from '@/lib/execution/real-positions';
import { getRunnerStatus } from '@/lib/runner/engine';
import { loadKillSwitchState, loadSystemState } from '@/lib/monitoring/system-state';
import { loadRunnerControlState } from '@/lib/monitoring/runner-control';
import { getPolymarketPrivateKey, getPolymarketOpenOrders, getPolymarketTokenBalance } from '@/lib/clients/polymarket-trading';
import { fetchPolymarketMarketByTokenId, fetchPolymarketPrice } from '@/lib/clients/polymarket';

export interface LiveOpsPosition {
  marketExternalId: string;
  question: string;
  netSize: number;
  avgEntryPrice: number;
  markPrice: number | null;
  unrealizedPct: number | null;
  onChainSize: number | null;
  openedAt: string;
}

export interface LiveOpsSnapshot {
  runner: ReturnType<typeof getRunnerStatus>;
  runnerControl: Awaited<ReturnType<typeof loadRunnerControlState>>;
  runnerLock: { owner?: string; heartbeatAt?: number } | null;
  killSwitch: Awaited<ReturnType<typeof loadKillSwitchState>>;
  tradeStats: Array<{ status: string; count: number }>;
  needsReview: Array<{ id: string; side: string; size: string; price: string; marketExternalId: string; createdAt: string }>;
  pendingOrders: Array<{ id: string; side: string; size: string; price: string; marketExternalId: string; createdAt: string; txHash: string | null }>;
  openPositions: LiveOpsPosition[];
  clobOpenOrders: unknown[];
}

const ENRICH_TIMEOUT_MS = 8_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function enrichPosition(
  pos: {
    marketExternalId: string;
    netSize: number;
    avgEntryPrice: number;
    openedAt: Date;
  },
  pk: string | null,
): Promise<LiveOpsPosition> {
  const tokenId = pos.marketExternalId;
  const [mkt, mark, onChain] = await Promise.all([
    withTimeout(fetchPolymarketMarketByTokenId(tokenId), ENRICH_TIMEOUT_MS, null),
    withTimeout(fetchPolymarketPrice(tokenId), ENRICH_TIMEOUT_MS, null),
    pk
      ? withTimeout(getPolymarketTokenBalance(pk, tokenId), ENRICH_TIMEOUT_MS, null)
      : Promise.resolve(null),
  ]);

  const unrealizedPct =
    mark != null && pos.avgEntryPrice > 0
      ? ((mark - pos.avgEntryPrice) / pos.avgEntryPrice) * 100
      : null;

  return {
    marketExternalId: tokenId,
    question: mkt?.question ?? tokenId.slice(0, 16),
    netSize: pos.netSize,
    avgEntryPrice: pos.avgEntryPrice,
    markPrice: mark,
    unrealizedPct,
    onChainSize: onChain,
    openedAt: pos.openedAt.toISOString(),
  };
}

export async function getLiveOpsSnapshot(): Promise<LiveOpsSnapshot> {
  const liveStrategies = await db.query.strategies.findMany({
    where: (s, { and, eq: eqFn }) => and(eqFn(s.isActive, true), eqFn(s.paperOnly, false)),
    columns: { id: true },
  });
  const ids = liveStrategies.map((s) => s.id);
  const pk = getPolymarketPrivateKey() ?? null;

  const [
    positionsByStrategy,
    needsReview,
    pendingOrders,
    statsRows,
    runnerControl,
    killSwitch,
    runnerLock,
    clobOpenOrders,
  ] = await Promise.all([
    ids.length > 0 ? getRealOpenPositionsByStrategy(ids) : Promise.resolve(new Map()),
    db.query.realTrades.findMany({
      where: eq(realTrades.status, 'needs_review'),
      orderBy: [desc(realTrades.createdAt)],
      limit: 20,
      columns: {
        id: true,
        side: true,
        size: true,
        price: true,
        marketExternalId: true,
        createdAt: true,
      },
    }),
    db.query.realTrades.findMany({
      where: eq(realTrades.status, 'pending'),
      orderBy: [desc(realTrades.createdAt)],
      limit: 20,
      columns: {
        id: true,
        side: true,
        size: true,
        price: true,
        marketExternalId: true,
        createdAt: true,
        txHash: true,
      },
    }),
    db
      .select({ status: realTrades.status, cnt: sql<number>`count(*)::int` })
      .from(realTrades)
      .groupBy(realTrades.status),
    loadRunnerControlState(),
    loadKillSwitchState(),
    loadSystemState<{ owner?: string; heartbeatAt?: number }>('runner_lock'),
    pk
      ? getPolymarketOpenOrders(pk).catch(() => [] as unknown[])
      : Promise.resolve([] as unknown[]),
  ]);

  const flatPositions = ids.flatMap((strategyId) => positionsByStrategy.get(strategyId) ?? []);
  const openPositions = await Promise.all(flatPositions.map((pos) => enrichPosition(pos, pk)));

  return {
    runner: getRunnerStatus(),
    runnerControl,
    runnerLock,
    killSwitch,
    tradeStats: statsRows.map((r) => ({ status: r.status, count: r.cnt })),
    needsReview: needsReview.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    pendingOrders: pendingOrders.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
    })),
    openPositions,
    clobOpenOrders,
  };
}

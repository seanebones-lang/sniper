/**
 * Live trading ops snapshot for /real dashboard.
 */
import { db, realTrades } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
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

export async function getLiveOpsSnapshot(): Promise<LiveOpsSnapshot> {
  const liveStrategies = await db.query.strategies.findMany({
    where: (s, { and, eq: eqFn }) => and(eqFn(s.isActive, true), eqFn(s.paperOnly, false)),
    columns: { id: true },
  });
  const ids = liveStrategies.map((s) => s.id);

  const positionsByStrategy = ids.length > 0 ? await getRealOpenPositionsByStrategy(ids) : new Map();
  const pk = getPolymarketPrivateKey();
  const openPositions: LiveOpsPosition[] = [];

  for (const strategyId of ids) {
    for (const pos of positionsByStrategy.get(strategyId) ?? []) {
      const mkt = await fetchPolymarketMarketByTokenId(pos.marketExternalId);
      const mark = await fetchPolymarketPrice(pos.marketExternalId);
      let onChain: number | null = null;
      if (pk) {
        onChain = await getPolymarketTokenBalance(pk, pos.marketExternalId);
      }
      const unrealizedPct =
        mark != null && pos.avgEntryPrice > 0
          ? ((mark - pos.avgEntryPrice) / pos.avgEntryPrice) * 100
          : null;
      openPositions.push({
        marketExternalId: pos.marketExternalId,
        question: mkt?.question ?? pos.marketExternalId.slice(0, 16),
        netSize: pos.netSize,
        avgEntryPrice: pos.avgEntryPrice,
        markPrice: mark,
        unrealizedPct,
        onChainSize: onChain,
        openedAt: pos.openedAt.toISOString(),
      });
    }
  }

  const needsReview = await db.query.realTrades.findMany({
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
  });

  const pendingOrders = await db.query.realTrades.findMany({
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
  });

  const statsRows = await db.query.realTrades.findMany({
    columns: { status: true },
    limit: 500,
  });
  const statMap = new Map<string, number>();
  for (const r of statsRows) {
    statMap.set(r.status, (statMap.get(r.status) ?? 0) + 1);
  }

  let clobOpenOrders: unknown[] = [];
  if (pk) {
    try {
      clobOpenOrders = await getPolymarketOpenOrders(pk);
    } catch {
      clobOpenOrders = [];
    }
  }

  const [runnerControl, killSwitch, runnerLock] = await Promise.all([
    loadRunnerControlState(),
    loadKillSwitchState(),
    loadSystemState<{ owner?: string; heartbeatAt?: number }>('runner_lock'),
  ]);

  return {
    runner: getRunnerStatus(),
    runnerControl,
    runnerLock,
    killSwitch,
    tradeStats: Array.from(statMap.entries()).map(([status, count]) => ({ status, count })),
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

/**
 * Performance attribution — live mode uses real fills + round trips only.
 */

import { db, paperTrades, signals, realTrades } from '@/lib/db';
import { chunkArray } from '@/lib/db/chunk-in-array';
import { gte, inArray, and, eq } from 'drizzle-orm';
import {
  computeStrategyPnlWindows,
  isLiveExecutionEnabled,
} from '@/lib/research/strategy-attribution';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { analyzeLiveRoundTrips } from '@/lib/execution/real-strategy-pnl';

interface StrategyStats {
  name: string;
  signals: number;
  paperFills: number;
  realFills: number;
  notionalUsd: number;
  estimatedPnlUsd: number;
  isActive: boolean;
}

export async function getStrategyPerformance(days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const live = isLiveExecutionEnabled();

  const stratRows = await db.query.strategies.findMany();
  const stratById = Object.fromEntries(stratRows.map((s) => [s.id, s]));
  const byStrategy: Record<string, StrategyStats> = {};

  for (const s of stratRows) {
    byStrategy[s.id] = {
      name: s.name,
      signals: 0,
      paperFills: 0,
      realFills: 0,
      notionalUsd: 0,
      estimatedPnlUsd: 0,
      isActive: s.isActive,
    };
  }

  const recentSignals = await db.query.signals.findMany({
    where: gte(signals.createdAt, since),
    columns: { strategyId: true },
  });

  for (const sig of recentSignals) {
    if (!byStrategy[sig.strategyId]) {
      byStrategy[sig.strategyId] = {
        name: stratById[sig.strategyId]?.name ?? 'Unknown',
        signals: 0,
        paperFills: 0,
        realFills: 0,
        notionalUsd: 0,
        estimatedPnlUsd: 0,
        isActive: stratById[sig.strategyId]?.isActive ?? false,
      };
    }
    byStrategy[sig.strategyId].signals++;
  }

  let totalPaperFills = 0;
  let totalRealFills = 0;

  if (live) {
    const realFills = await db.query.realTrades.findMany({
      where: and(eq(realTrades.status, 'filled'), gte(realTrades.filledAt, since)),
      columns: { signalId: true, size: true, price: true },
    });
    totalRealFills = realFills.length;
    const realSignalIds = realFills.map((t) => t.signalId).filter(Boolean) as string[];
    const realLinked: Array<{ id: string; strategyId: string }> = [];
    for (const ids of chunkArray(realSignalIds)) {
      const batch = await db.query.signals.findMany({
        where: inArray(signals.id, ids),
        columns: { id: true, strategyId: true },
      });
      realLinked.push(...batch);
    }
    const realSignalStrategyMap = Object.fromEntries(realLinked.map((s) => [s.id, s.strategyId]));
    for (const fill of realFills) {
      const strategyId = fill.signalId ? realSignalStrategyMap[fill.signalId] : null;
      if (strategyId && byStrategy[strategyId]) {
        byStrategy[strategyId].realFills++;
        byStrategy[strategyId].notionalUsd += parseFloat(fill.size) * parseFloat(fill.price);
      }
    }

    const pnlWindows = await computeStrategyPnlWindows(stratRows.map((s) => s.id), days * 24);
    for (const [id, stats] of pnlWindows) {
      if (byStrategy[id]) byStrategy[id].estimatedPnlUsd = stats.estimatedPnl;
    }

    const liveAttr = await analyzeLiveRoundTrips(Math.min(days * 24, 168));
    const primaryLive = stratRows.find((s) => s.isActive && s.paperOnly === false);
    if (primaryLive && byStrategy[primaryLive.id]) {
      byStrategy[primaryLive.id].estimatedPnlUsd = liveAttr.totalPnlUsd;
    }

    return {
      periodDays: days,
      mode: 'live' as const,
      totalSignals: recentSignals.length,
      totalPaperFills: 0,
      totalRealFills,
      liveRoundTrips: liveAttr.roundTrips,
      liveWinRatePct: liveAttr.winRatePct,
      liveTotalPnlUsd: liveAttr.totalPnlUsd,
      byStrategy,
      activeStrategies: stratRows.filter((s) => s.isActive).length,
    };
  }

  const runStart = await getPaperRunStartedAt();
  const paperSince = runStart && runStart > since ? runStart : since;
  const recentPaper = await db.query.paperTrades.findMany({
    where: gte(paperTrades.filledAt, paperSince),
    columns: { signalId: true, size: true, price: true },
  });
  totalPaperFills = recentPaper.length;

  const signalIds = recentPaper.map((t) => t.signalId).filter(Boolean) as string[];
  const linkedSignals: Array<{ id: string; strategyId: string }> = [];
  for (const ids of chunkArray(signalIds)) {
    const batch = await db.query.signals.findMany({
      where: inArray(signals.id, ids),
      columns: { id: true, strategyId: true },
    });
    linkedSignals.push(...batch);
  }
  const signalStrategyMap = Object.fromEntries(linkedSignals.map((s) => [s.id, s.strategyId]));

  for (const fill of recentPaper) {
    const strategyId = fill.signalId ? signalStrategyMap[fill.signalId] : null;
    if (strategyId && byStrategy[strategyId]) {
      byStrategy[strategyId].paperFills++;
      byStrategy[strategyId].notionalUsd += parseFloat(fill.size) * parseFloat(fill.price);
    }
  }

  const pnlWindows = await computeStrategyPnlWindows(stratRows.map((s) => s.id), days * 24);
  for (const [id, stats] of pnlWindows) {
    if (byStrategy[id]) byStrategy[id].estimatedPnlUsd = stats.estimatedPnl;
  }

  const recentReal = await db.query.realTrades.findMany({
    where: gte(realTrades.filledAt, since),
    columns: { id: true },
  });
  totalRealFills = recentReal.length;

  return {
    periodDays: days,
    mode: 'paper' as const,
    totalSignals: recentSignals.length,
    totalPaperFills,
    totalRealFills,
    byStrategy,
    activeStrategies: stratRows.filter((s) => s.isActive).length,
  };
}

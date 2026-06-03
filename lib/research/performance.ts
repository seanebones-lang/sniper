/**
 * Performance attribution — joins signals to paper fills via signalId.
 */

import { db, paperTrades, signals, realTrades } from '@/lib/db';
import { chunkArray } from '@/lib/db/chunk-in-array';
import { gte, inArray } from 'drizzle-orm';
import { computeStrategyPnlWindows } from '@/lib/paper/strategy-pnl';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';

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
  const runStart = await getPaperRunStartedAt();
  const paperSince = runStart && runStart > since ? runStart : since;

  const [recentSignals, recentPaper, recentReal, stratRows] = await Promise.all([
    db.query.signals.findMany({ where: gte(signals.createdAt, since) }),
    db.query.paperTrades.findMany({ where: gte(paperTrades.filledAt, paperSince) }),
    db.query.realTrades.findMany({ where: gte(realTrades.createdAt, since) }),
    db.query.strategies.findMany(),
  ]);

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
    if (byStrategy[id]) {
      byStrategy[id].estimatedPnlUsd = stats.estimatedPnl;
    }
  }

  return {
    periodDays: days,
    totalSignals: recentSignals.length,
    totalPaperFills: recentPaper.length,
    totalRealFills: recentReal.length,
    byStrategy,
    activeStrategies: stratRows.filter((s) => s.isActive).length,
  };
}

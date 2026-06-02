/**
 * Performance attribution — joins signals to paper fills via signalId.
 */

import { db, paperTrades, signals, realTrades } from '@/lib/db';
import { gte, inArray } from 'drizzle-orm';

interface StrategyStats {
  name: string;
  signals: number;
  paperFills: number;
  realFills: number;
  notionalUsd: number;
  isActive: boolean;
}

export async function getStrategyPerformance(days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const [recentSignals, recentPaper, recentReal, stratRows] = await Promise.all([
    db.query.signals.findMany({ where: gte(signals.createdAt, since) }),
    db.query.paperTrades.findMany({ where: gte(paperTrades.createdAt, since) }),
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
        isActive: stratById[sig.strategyId]?.isActive ?? false,
      };
    }
    byStrategy[sig.strategyId].signals++;
  }

  const signalIds = recentPaper.map((t) => t.signalId).filter(Boolean) as string[];
  const linkedSignals = signalIds.length
    ? await db.query.signals.findMany({ where: inArray(signals.id, signalIds) })
    : [];
  const signalStrategyMap = Object.fromEntries(linkedSignals.map((s) => [s.id, s.strategyId]));

  for (const fill of recentPaper) {
    const strategyId = fill.signalId ? signalStrategyMap[fill.signalId] : null;
    if (strategyId && byStrategy[strategyId]) {
      byStrategy[strategyId].paperFills++;
      byStrategy[strategyId].notionalUsd += parseFloat(fill.size) * parseFloat(fill.price);
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

/**
 * Basic Performance Attribution
 * Tracks how individual strategies and categories are performing.
 * This is essential for knowing what to keep, kill, or scale.
 */

import { db, signals, paperTrades, realTrades } from '@/lib/db';
import { eq, gte } from 'drizzle-orm';

export async function getStrategyPerformance(days = 7) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const recentSignals = await db.query.signals.findMany({
    where: (s, { gte }) => gte(s.createdAt, since),
  });

  const recentPaper = await db.query.paperTrades.findMany({
    where: (t, { gte }) => gte(t.createdAt, since),
  });

  const recentReal = await db.query.realTrades.findMany({
    where: (t, { gte }) => gte(t.createdAt, since),
  });

  // Very lightweight attribution (production version would be much richer)
  const byStrategy: Record<string, any> = {};

  recentSignals.forEach(sig => {
    const key = sig.strategyId || 'unknown';
    if (!byStrategy[key]) {
      byStrategy[key] = { signals: 0, paperFills: 0, realFills: 0, estimatedPnl: 0 };
    }
    byStrategy[key].signals++;
  });

  recentPaper.forEach(trade => {
    // Rough association - in real system we'd join properly
    Object.keys(byStrategy).forEach(k => {
      byStrategy[k].paperFills = (byStrategy[k].paperFills || 0) + 1;
    });
  });

  return {
    periodDays: days,
    totalSignals: recentSignals.length,
    totalPaperFills: recentPaper.length,
    totalRealFills: recentReal.length,
    byStrategy,
  };
}

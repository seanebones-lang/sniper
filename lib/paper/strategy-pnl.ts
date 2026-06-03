import { db, paperTrades, signals } from '@/lib/db';
import { chunkArray } from '@/lib/db/chunk-in-array';
import { eq, gte, and, inArray } from 'drizzle-orm';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import type { StrategyPerformanceWindow } from '@/lib/monitoring/edge-decay';

export interface StrategyPnlStats {
  strategyId: string;
  signals: number;
  fills: number;
  estimatedPnl: number;
  avgSlippage: number;
}

/**
 * Per-strategy PnL from paper fills linked via signalId.
 * Uses average-cost realized PnL on sells (same as ledger).
 */
export async function computeStrategyPnlWindows(
  strategyIds: string[],
  windowHours = 6,
): Promise<Map<string, StrategyPnlStats>> {
  const runStart = await getPaperRunStartedAt();
  const windowStart = new Date(Date.now() - windowHours * 3600 * 1000);
  const since = runStart && runStart > windowStart ? runStart : windowStart;

  const stratSignals = await db.query.signals.findMany({
    where: and(
      inArray(signals.strategyId, strategyIds),
      gte(signals.createdAt, since),
    ),
    columns: { id: true, strategyId: true },
  });

  const signalIds = stratSignals.map((s) => s.id);
  const signalToStrategy = Object.fromEntries(stratSignals.map((s) => [s.id, s.strategyId]));

  const fills: Awaited<ReturnType<typeof db.query.paperTrades.findMany>> = [];
  for (const ids of chunkArray(signalIds)) {
    const batch = await db.query.paperTrades.findMany({
      where: and(inArray(paperTrades.signalId, ids), gte(paperTrades.filledAt, since)),
      orderBy: (t, { asc }) => [asc(t.filledAt)],
    });
    fills.push(...batch);
  }

  const stats = new Map<string, StrategyPnlStats>();
  for (const id of strategyIds) {
    stats.set(id, { strategyId: id, signals: 0, fills: 0, estimatedPnl: 0, avgSlippage: 0 });
  }

  for (const sig of stratSignals) {
    const row = stats.get(sig.strategyId);
    if (row) row.signals++;
  }

  const posByStrategyMarket = new Map<string, { net: number; cost: number }>();

  for (const fill of fills) {
    const strategyId = fill.signalId ? signalToStrategy[fill.signalId] : null;
    if (!strategyId) continue;

    const row = stats.get(strategyId)!;
    row.fills++;

    const size = parseFloat(fill.size);
    const price = parseFloat(fill.price);
    const posKey = `${strategyId}:${fill.platform}:${fill.marketExternalId}`;
    const pos = posByStrategyMarket.get(posKey) ?? { net: 0, cost: 0 };

    if (fill.side === 'BUY') {
      pos.net += size;
      pos.cost += size * price;
    } else {
      const avg = pos.net > 0.01 ? pos.cost / pos.net : price;
      row.estimatedPnl += (price - avg) * size;
      pos.net -= size;
      pos.cost -= avg * size;
      if (pos.net <= 0.01) {
        pos.net = 0;
        pos.cost = 0;
      }
    }
    posByStrategyMarket.set(posKey, pos);
  }

  return stats;
}

export function statsToPerformanceWindow(
  stats: StrategyPnlStats,
  windowHours: number,
): StrategyPerformanceWindow {
  const now = new Date();
  return {
    strategyId: stats.strategyId,
    windowStart: new Date(now.getTime() - windowHours * 3600 * 1000),
    windowEnd: now,
    signals: stats.signals,
    fills: stats.fills,
    estimatedPnl: stats.estimatedPnl,
    avgSlippage: stats.avgSlippage,
  };
}

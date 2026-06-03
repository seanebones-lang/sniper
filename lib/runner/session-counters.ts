import { db, signals, paperTrades } from '@/lib/db';
import { count, gte } from 'drizzle-orm';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';

/** DB-backed session stats for the current paper run (same window as P&L / equity curve). */
export async function countRunnerSessionStats(): Promise<{ signals: number; fills: number }> {
  const runStart = await getPaperRunStartedAt();
  if (!runStart) {
    return { signals: 0, fills: 0 };
  }

  const [sigRow, fillRow] = await Promise.all([
    db.select({ count: count() }).from(signals).where(gte(signals.createdAt, runStart)),
    db.select({ count: count() }).from(paperTrades).where(gte(paperTrades.filledAt, runStart)),
  ]);

  return {
    signals: sigRow[0]?.count ?? 0,
    fills: fillRow[0]?.count ?? 0,
  };
}

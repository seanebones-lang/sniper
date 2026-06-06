import { db, signals, paperTrades, realTrades } from '@/lib/db';
import { and, count, gte, eq, isNotNull } from 'drizzle-orm';
import { getPaperRunStartedAt } from '@/lib/paper/run-session';
import { getLiveZenSessionStartedAt } from '@/lib/zen/live-session';

const LIVE_STATS_LOOKBACK_MS = 7 * 24 * 3600 * 1000;

/** DB-backed session stats (signals + fills in the active trading window). */
export async function countRunnerSessionStats(): Promise<{ signals: number; fills: number }> {
  const liveEnabled = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
  const runStart = liveEnabled ? await getLiveZenSessionStartedAt() : await getPaperRunStartedAt();
  const since = runStart ?? new Date(Date.now() - LIVE_STATS_LOOKBACK_MS);

  const [sigRow, paperFillRow, realFillRow] = await Promise.all([
    db.select({ count: count() }).from(signals).where(gte(signals.createdAt, since)),
    liveEnabled
      ? Promise.resolve([{ count: 0 }])
      : db.select({ count: count() }).from(paperTrades).where(gte(paperTrades.filledAt, since)),
    liveEnabled
      ? db
          .select({ count: count() })
          .from(realTrades)
          .where(
            and(
              eq(realTrades.status, 'filled'),
              isNotNull(realTrades.filledAt),
              gte(realTrades.filledAt, since),
            ),
          )
      : Promise.resolve([{ count: 0 }]),
  ]);

  const paperFills = paperFillRow[0]?.count ?? 0;
  const realFills = realFillRow[0]?.count ?? 0;

  return {
    signals: sigRow[0]?.count ?? 0,
    fills: liveEnabled ? realFills : paperFills,
  };
}

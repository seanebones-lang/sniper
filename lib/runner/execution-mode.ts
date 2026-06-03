import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { isRealExecutionAllowed } from '@/lib/execution/real-executor';

export type RunnerExecutionMode = 'paper' | 'live' | 'mixed';

/** Whether active strategies + env allow real CLOB orders. */
export async function getRunnerExecutionMode(): Promise<RunnerExecutionMode> {
  const active = await db.query.strategies.findMany({
    where: eq(strategies.isActive, true),
    columns: { paperOnly: true },
  });
  const realAllowed = await isRealExecutionAllowed();
  const liveCount = active.filter((s) => !s.paperOnly).length;
  if (!realAllowed || liveCount === 0) return 'paper';
  if (liveCount >= active.length) return 'live';
  return 'mixed';
}

export function isLiveExecutionMode(mode: RunnerExecutionMode): boolean {
  return mode === 'live' || mode === 'mixed';
}
